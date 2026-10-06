const express = require('express')
const { allowRoles, authenticate } = require('../middleware/auth')
const { AuditLog, Comment, Counter, Notification, SLA, Ticket, User, WorkLog } = require('../models')

const router = express.Router()
const statuses = ['Open', 'Assigned', 'In Progress', 'Pending', 'Escalated', 'Resolved', 'Closed', 'Reopened']
const priorities = ['Low', 'Medium', 'High', 'Critical']
const populate = [{ path: 'employee', select: 'name email role department' }, { path: 'assignedTo', select: 'name email role' }, { path: 'department', select: 'name' }, { path: 'category', select: 'name' }]

function canRead(user, ticket) {
    if (user.role === 'System Admin' || user.role === 'IT Manager') return user.role === 'System Admin' || String(user.department?._id || user.department) === String(ticket.department?._id || ticket.department)
    if (user.role === 'Technician') return String(ticket.assignedTo?._id || ticket.assignedTo) === user.id || String(user.department?._id || user.department) === String(ticket.department?._id || ticket.department)
    return String(ticket.employee?._id || ticket.employee) === user.id
}

async function record(req, ticket, action, from, to) {
    ticket.history.push({ actor: req.user.id, action, from, to, at: new Date() })
    await ticket.save()
    await AuditLog.create({ user: req.user.id, action, entity: 'Ticket', entityId: ticket.id, previous: from, next: to })
}

async function notify(recipient, title, message, ticket) {
    if (recipient) await Notification.create({ recipient, title, message, type: 'ticket', entityType: 'Ticket', entityId: ticket.id })
}

router.use(authenticate)

router.get('/', async (req, res, next) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1)
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
        const filter = {}
        if (req.user.role === 'Employee') filter.employee = req.user.id
        if (req.user.role === 'Technician') filter.$or = [{ assignedTo: req.user.id }, { department: req.user.department }]
        if (req.user.role === 'IT Manager') filter.department = req.user.department
        for (const field of ['status', 'priority', 'department', 'category', 'assignedTo']) if (req.query[field]) filter[field] = req.query[field]
        if (req.query.search) filter.$text = { $search: String(req.query.search).slice(0, 100) }
        const [items, total] = await Promise.all([Ticket.find(filter).populate(populate).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), Ticket.countDocuments(filter)])
        return res.json({ items, page, limit, total, pages: Math.ceil(total / limit) })
    } catch (error) { return next(error) }
})

router.post('/', allowRoles('Employee'), async (req, res, next) => {
    try {
        const { title, description, priority = 'Medium', category, subcategory, attachments = [] } = req.body
        if (!title?.trim() || !description?.trim() || !priorities.includes(priority)) return res.status(400).json({ error: { message: 'Title, description and a valid priority are required' } })
        const sequence = await Counter.findByIdAndUpdate('ticket', { $inc: { value: 1 } }, { upsert: true, new: true })
        const sla = await SLA.findOne({ priority, active: true })
        const now = Date.now()
        const ticket = await Ticket.create({ ticketId: `SD-${new Date().getFullYear()}-${String(sequence.value).padStart(6, '0')}`, title: title.trim(), description: description.trim(), employee: req.user.id, department: req.user.department, category: category || undefined, subcategory, priority, sla: sla?.id, responseDueAt: sla ? new Date(now + sla.responseMinutes * 60000) : undefined, resolutionDueAt: sla ? new Date(now + sla.resolutionMinutes * 60000) : undefined, attachments: Array.isArray(attachments) ? attachments.slice(0, 5) : [], history: [{ actor: req.user.id, action: 'created', at: new Date() }] })
        await AuditLog.create({ user: req.user.id, action: 'created', entity: 'Ticket', entityId: ticket.id })
        const managers = await User.find({ role: { $in: ['IT Manager', 'System Admin'] }, ...(req.user.department ? { department: req.user.department } : {}) }).select('_id')
        await Promise.all(managers.map((manager) => notify(manager.id, `New ticket ${ticket.ticketId}`, ticket.title, ticket)))
        return res.status(201).json({ item: await ticket.populate(populate) })
    } catch (error) { return next(error) }
})

router.get('/:id', async (req, res, next) => {
    try {
        const ticket = await Ticket.findById(req.params.id).populate(populate)
        if (!ticket) return res.status(404).json({ error: { message: 'Ticket not found' } })
        if (!canRead(req.user, ticket)) return res.status(403).json({ error: { message: 'Ticket is outside your access scope' } })
        const [comments, workLogs] = await Promise.all([Comment.find({ ticket: ticket.id, ...(req.user.role === 'Employee' ? { internal: false } : {}) }).populate('author', 'name role').sort({ createdAt: 1 }), WorkLog.find({ ticket: ticket.id }).populate('technician', 'name').sort({ workedAt: -1 })])
        return res.json({ item: ticket, comments, workLogs })
    } catch (error) { return next(error) }
})

router.patch('/:id', async (req, res, next) => {
    try {
        const ticket = await Ticket.findById(req.params.id).populate(populate)
        if (!ticket) return res.status(404).json({ error: { message: 'Ticket not found' } })
        if (!canRead(req.user, ticket) || req.user.role === 'Employee') return res.status(403).json({ error: { message: 'You cannot edit this ticket' } })
        const changed = {}
        for (const field of ['title', 'description', 'priority', 'category', 'subcategory']) {
            if (req.body[field] !== undefined) {
                if (field === 'priority' && !priorities.includes(req.body[field])) return res.status(400).json({ error: { message: 'Invalid priority' } })
                changed[field] = { from: ticket[field], to: req.body[field] }
                ticket[field] = req.body[field]
            }
        }
        await record(req, ticket, 'updated', undefined, changed)
        return res.json({ item: await ticket.populate(populate) })
    } catch (error) { return next(error) }
})

router.patch('/:id/assign', allowRoles('System Admin', 'IT Manager'), async (req, res, next) => {
    try {
        const ticket = await Ticket.findById(req.params.id)
        const technician = await User.findOne({ _id: req.body.technician, role: 'Technician', active: true })
        if (!ticket || !technician) return res.status(404).json({ error: { message: 'Ticket or active technician not found' } })
        if (req.user.role === 'IT Manager' && String(ticket.department) !== String(req.user.department)) return res.status(403).json({ error: { message: 'Ticket is outside your department' } })
        const previous = ticket.assignedTo
        ticket.assignedTo = technician.id
        if (ticket.status === 'Open' || ticket.status === 'Reopened') ticket.status = 'Assigned'
        const sla = await SLA.findOne({ priority: ticket.priority, active: true })
        if (sla) { ticket.sla = sla.id; ticket.responseDueAt = new Date(Date.now() + sla.responseMinutes * 60000); ticket.resolutionDueAt = new Date(Date.now() + sla.resolutionMinutes * 60000) }
        await record(req, ticket, 'assigned', previous, technician.id)
        await notify(technician.id, `Assigned ${ticket.ticketId}`, ticket.title, ticket)
        return res.json({ item: await ticket.populate(populate) })
    } catch (error) { return next(error) }
})

router.patch('/:id/status', async (req, res, next) => {
    try {
        const ticket = await Ticket.findById(req.params.id)
        if (!ticket) return res.status(404).json({ error: { message: 'Ticket not found' } })
        if (!canRead(req.user, ticket) || (req.user.role === 'Employee' && !['Closed', 'Reopened'].includes(req.body.status))) return res.status(403).json({ error: { message: 'You cannot change this ticket status' } })
        if (!statuses.includes(req.body.status)) return res.status(400).json({ error: { message: 'Invalid ticket status' } })
        if (req.body.status === 'Closed' && !['System Admin', 'IT Manager', 'Employee'].includes(req.user.role)) return res.status(403).json({ error: { message: 'Only a manager or requester can close a resolved ticket' } })
        if (req.body.status === 'Closed' && ticket.status !== 'Resolved') return res.status(400).json({ error: { message: 'Only resolved tickets can be closed' } })
        if (req.body.status === 'Reopened' && ticket.status !== 'Resolved' && ticket.status !== 'Closed') return res.status(400).json({ error: { message: 'Only resolved or closed tickets can be reopened' } })
        const previous = ticket.status
        ticket.status = req.body.status
        if (req.body.status === 'Resolved') ticket.resolvedAt = new Date()
        await record(req, ticket, req.body.status.toLowerCase(), previous, req.body.status)
        await notify(ticket.employee, `Ticket ${ticket.ticketId} ${req.body.status.toLowerCase()}`, ticket.title, ticket)
        return res.json({ item: await ticket.populate(populate) })
    } catch (error) { return next(error) }
})

router.post('/:id/comments', async (req, res, next) => {
    try {
        const ticket = await Ticket.findById(req.params.id)
        if (!ticket || !canRead(req.user, ticket)) return res.status(ticket ? 403 : 404).json({ error: { message: ticket ? 'Ticket is outside your access scope' : 'Ticket not found' } })
        const body = String(req.body.body || '').trim()
        const internal = req.body.internal === true
        if (!body || body.length > 10000) return res.status(400).json({ error: { message: 'Comment must be between 1 and 10000 characters' } })
        if (internal && !['System Admin', 'IT Manager', 'Technician'].includes(req.user.role)) return res.status(403).json({ error: { message: 'Internal notes are for support staff only' } })
        const comment = await Comment.create({ ticket: ticket.id, author: req.user.id, body, internal })
        await record(req, ticket, internal ? 'internal note added' : 'comment added')
        await notify(ticket.employee, `New comment on ${ticket.ticketId}`, internal ? 'A support note was added' : body.slice(0, 160), ticket)
        return res.status(201).json({ item: await comment.populate('author', 'name role') })
    } catch (error) { return next(error) }
})

router.post('/:id/worklogs', allowRoles('System Admin', 'IT Manager', 'Technician'), async (req, res, next) => {
    try {
        const ticket = await Ticket.findById(req.params.id)
        const minutes = Number(req.body.minutes)
        if (!ticket || !canRead(req.user, ticket)) return res.status(ticket ? 403 : 404).json({ error: { message: ticket ? 'Ticket outside department scope' : 'Ticket not found' } })
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440 || !req.body.description?.trim()) return res.status(400).json({ error: { message: 'Work description and minutes from 1 to 1440 are required' } })
        const item = await WorkLog.create({ ticket: ticket.id, technician: req.user.id, minutes, description: req.body.description.trim(), workedAt: req.body.workedAt })
        await record(req, ticket, 'work logged', undefined, { minutes })
        return res.status(201).json({ item: await item.populate('technician', 'name') })
    } catch (error) { return next(error) }
})

router.post('/:id/escalate', allowRoles('System Admin', 'IT Manager', 'Technician'), async (req, res, next) => {
    try {
        const ticket = await Ticket.findById(req.params.id)
        if (!ticket || !canRead(req.user, ticket)) return res.status(ticket ? 403 : 404).json({ error: { message: ticket ? 'Ticket outside department scope' : 'Ticket not found' } })
        const previous = ticket.status
        ticket.status = 'Escalated'
        await record(req, ticket, 'escalated', previous, 'Escalated')
        const managers = await User.find({ role: { $in: ['IT Manager', 'System Admin'] }, department: ticket.department }).select('_id')
        await Promise.all(managers.map((manager) => notify(manager.id, `Escalated ${ticket.ticketId}`, ticket.title, ticket)))
        return res.json({ item: ticket })
    } catch (error) { return next(error) }
})

module.exports = router
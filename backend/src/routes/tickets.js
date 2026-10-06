const express = require('express')
const { allowRoles, authenticate } = require('../middleware/auth')
const { AuditLog, Comment, Counter, Notification, SLA, Ticket, User, WorkLog } = require('../models')

const router = express.Router()
const statuses = ['Open', 'Assigned', 'In Progress', 'Pending', 'Escalated', 'Resolved', 'Closed', 'Reopened']
const priorities = ['Low', 'Medium', 'High', 'Critical']
const populate = [
    { path: 'employee', select: 'name email role department' },
    { path: 'assignedTo', select: 'name email role' },
    { path: 'department', select: 'name' },
    { path: 'category', select: 'name' },
    { path: 'assignmentRequests.technician', select: 'name email role' },
    { path: 'assignmentRequests.requestedBy', select: 'name role' },
]

function canRead(user, ticket) {
    if (user.role === 'System Admin') return true
    if (user.role === 'IT Manager') return Boolean(user.department && ticket.department && String(user.department?._id || user.department) === String(ticket.department?._id || ticket.department))
    if (user.role === 'Technician') {
        const invited = ticket.assignmentRequests?.some((request) => String(request.technician?._id || request.technician) === user.id && request.status === 'Pending')
        const sameDepartment = user.department && ticket.department && String(user.department?._id || user.department) === String(ticket.department?._id || ticket.department)
        return String(ticket.assignedTo?._id || ticket.assignedTo) === user.id || invited || sameDepartment
    }
    if (user.role === 'Asset Manager') return true
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
        if (req.user.role === 'Technician') {
            filter.$or = [{ assignedTo: req.user.id }, { 'assignmentRequests.technician': req.user.id }]
            if (req.user.department) filter.$or.push({ department: req.user.department })
        }
        if (req.user.role === 'IT Manager') filter.department = req.user.department || null
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
        if (req.user.role === 'IT Manager' && (!req.user.department || String(ticket.department) !== String(req.user.department))) return res.status(403).json({ error: { message: 'Ticket is outside your department' } })
        if (['Resolved', 'Closed'].includes(ticket.status)) return res.status(400).json({ error: { message: 'Reopen this ticket before requesting a technician' } })
        if (String(ticket.assignedTo || '') === technician.id) return res.status(400).json({ error: { message: 'This technician is already assigned to the ticket' } })
        if (ticket.assignmentRequests.some((request) => request.status === 'Pending')) return res.status(409).json({ error: { message: 'Wait for the pending technician response before requesting another assignment' } })
        ticket.assignmentRequests.push({ technician: technician.id, requestedBy: req.user.id, status: 'Pending' })
        await record(req, ticket, 'technician acceptance requested', undefined, technician.name)
        await notify(technician.id, `Availability requested for ${ticket.ticketId}`, `Please accept this ticket or decline with a reason: ${ticket.title}`, ticket)
        return res.json({ item: await ticket.populate(populate) })
    } catch (error) { return next(error) }
})

router.patch('/:id/assignment-response', allowRoles('Technician'), async (req, res, next) => {
    try {
        const ticket = await Ticket.findById(req.params.id)
        if (!ticket) return res.status(404).json({ error: { message: 'Ticket not found' } })
        if (['Resolved', 'Closed'].includes(ticket.status)) return res.status(400).json({ error: { message: 'Reopen this ticket before responding to an assignment request' } })
        const assignment = [...ticket.assignmentRequests].reverse().find((request) => String(request.technician) === req.user.id && request.status === 'Pending')
        if (!assignment) return res.status(404).json({ error: { message: 'No pending assignment request was found for you' } })
        const decision = req.body.decision
        const reason = String(req.body.reason || '').trim()
        if (!['accept', 'decline'].includes(decision)) return res.status(400).json({ error: { message: 'Choose accept or decline' } })
        if (decision === 'decline' && (!reason || reason.length > 1000)) return res.status(400).json({ error: { message: 'Provide a reason of no more than 1000 characters when declining' } })

        const previousAssignee = ticket.assignedTo
        assignment.status = decision === 'accept' ? 'Accepted' : 'Declined'
        assignment.reason = decision === 'decline' ? reason : undefined
        assignment.respondedAt = new Date()
        if (decision === 'accept') {
            ticket.assignedTo = req.user.id
            ticket.status = 'Assigned'
        }
        await record(req, ticket, decision === 'accept' ? 'technician accepted assignment' : 'technician declined assignment', 'Pending', decision === 'accept' ? req.user.name : reason)
        if (decision === 'accept' && previousAssignee && String(previousAssignee) !== req.user.id) {
            await notify(previousAssignee, `Ticket ${ticket.ticketId} reassigned`, `The ticket was accepted by ${req.user.name}.`, ticket)
        }
        const recipients = new Set([String(assignment.requestedBy), String(ticket.employee)])
        await Promise.all([...recipients].filter((recipient) => recipient !== req.user.id).map((recipient) => notify(
            recipient,
            decision === 'accept' ? `Technician accepted ${ticket.ticketId}` : `Technician declined ${ticket.ticketId}`,
            decision === 'accept' ? `${req.user.name} accepted the ticket and can now start work.` : `${req.user.name} declined the ticket: ${reason}`,
            ticket,
        )))
        return res.json({ item: await ticket.populate(populate) })
    } catch (error) { return next(error) }
})

router.patch('/:id/status', async (req, res, next) => {
    try {
        const ticket = await Ticket.findById(req.params.id)
        if (!ticket) return res.status(404).json({ error: { message: 'Ticket not found' } })
        if (!canRead(req.user, ticket)) return res.status(403).json({ error: { message: 'You cannot change this ticket status' } })
        if (!statuses.includes(req.body.status)) return res.status(400).json({ error: { message: 'Invalid ticket status' } })
        const allowedStatuses = {
            Employee: ['Closed', 'Reopened'],
            'IT Manager': ['Pending', 'Escalated'],
            Technician: ['In Progress', 'Pending', 'Escalated', 'Resolved'],
            'System Admin': ['Pending', 'Escalated', 'Reopened'],
            'Asset Manager': [],
        }
        if (!allowedStatuses[req.user.role]?.includes(req.body.status)) return res.status(403).json({ error: { message: 'Your role cannot set this ticket status' } })
        if (req.user.role === 'Technician' && String(ticket.assignedTo) !== req.user.id) return res.status(403).json({ error: { message: 'Accept the assignment before updating ticket status' } })
        if (req.body.status === 'Closed' && !['System Admin', 'IT Manager', 'Employee'].includes(req.user.role)) return res.status(403).json({ error: { message: 'Only a manager or requester can close a resolved ticket' } })
        if (req.body.status === 'Closed' && ticket.status !== 'Resolved') return res.status(400).json({ error: { message: 'Only resolved tickets can be closed' } })
        if (req.body.status === 'Reopened' && ticket.status !== 'Resolved' && ticket.status !== 'Closed') return res.status(400).json({ error: { message: 'Only resolved or closed tickets can be reopened' } })
        if (['Resolved', 'Closed'].includes(ticket.status) && req.body.status !== 'Reopened' && req.body.status !== 'Closed') return res.status(400).json({ error: { message: 'Reopen the ticket before changing its status' } })
        if (req.user.role === 'Technician' && req.body.status === 'In Progress' && !['Assigned', 'Pending', 'In Progress'].includes(ticket.status)) return res.status(400).json({ error: { message: 'Work can only start on an assigned or pending ticket' } })
        if (req.user.role === 'Technician' && req.body.status === 'Resolved' && !['In Progress', 'Pending', 'Escalated'].includes(ticket.status)) return res.status(400).json({ error: { message: 'Start working on the ticket before resolving it' } })
        if (req.user.role === 'IT Manager' && req.body.status === 'Pending' && ['Resolved', 'Closed'].includes(ticket.status)) return res.status(400).json({ error: { message: 'Resolved tickets cannot be put on hold' } })
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
        const description = String(req.body.description || '').trim()
        if (!ticket || !canRead(req.user, ticket)) return res.status(ticket ? 403 : 404).json({ error: { message: ticket ? 'Ticket outside department scope' : 'Ticket not found' } })
        if (req.user.role === 'Technician' && (String(ticket.assignedTo) !== req.user.id || ticket.status !== 'In Progress')) return res.status(403).json({ error: { message: 'Only the assigned technician can log work while the ticket is in progress' } })
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440 || !description || description.length > 2000) return res.status(400).json({ error: { message: 'A work description of 1 to 2000 characters and minutes from 1 to 1440 are required' } })
        const item = await WorkLog.create({ ticket: ticket.id, technician: req.user.id, minutes, description, workedAt: req.body.workedAt })
        await record(req, ticket, 'work logged', undefined, { minutes })
        const managers = await User.find({ role: { $in: ['IT Manager', 'System Admin'] }, ...(ticket.department ? { department: ticket.department } : {}) }).select('_id')
        const recipients = new Set([String(ticket.employee), ...managers.map((manager) => String(manager.id))])
        await Promise.all([...recipients].filter((recipient) => recipient !== req.user.id).map((recipient) => notify(recipient, `Work update on ${ticket.ticketId}`, `${req.user.name} logged ${minutes} minutes: ${description.slice(0, 140)}`, ticket)))
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
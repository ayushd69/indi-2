const express = require('express')
const bcrypt = require('bcryptjs')
const mongoose = require('mongoose')
const { allowRoles, authenticate } = require('../middleware/auth')
const { Asset, AuditLog, Category, Department, KnowledgeArticle, Notification, SLA, Ticket, User, Vendor, WorkLog, systemAdminEmail } = require('../models')

const router = express.Router()
const resources = {
    departments: { model: Department, write: ['System Admin'] },
    categories: { model: Category, write: ['System Admin'] },
    slas: { model: SLA, write: ['System Admin'] },
    users: { model: User, write: ['System Admin'] },
    assets: { model: Asset, write: ['System Admin', 'Asset Manager'] },
    vendors: { model: Vendor, write: ['System Admin', 'Asset Manager'] },
    articles: { model: KnowledgeArticle, write: ['System Admin', 'IT Manager', 'Technician'] },
}

router.use(authenticate)

router.get('/technicians', allowRoles('System Admin', 'IT Manager'), async (req, res, next) => {
    try {
        const items = await User.find({ role: 'Technician', active: true }).select('name email department').populate('department', 'name').sort({ name: 1 })
        return res.json({ items })
    } catch (error) { return next(error) }
})

router.get('/dashboard', async (req, res, next) => {
    try {
        const scope = req.user.role === 'Employee' ? { employee: new mongoose.Types.ObjectId(req.user.id) } : req.user.role === 'Technician' ? { assignedTo: new mongoose.Types.ObjectId(req.user.id) } : req.user.role === 'IT Manager' ? { department: new mongoose.Types.ObjectId(req.user.department) } : {}
        const [ticketCounts, priorityCounts, assets, unread, userCount] = await Promise.all([
            Ticket.aggregate([{ $match: scope }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
            Ticket.aggregate([{ $match: scope }, { $group: { _id: '$priority', count: { $sum: 1 } } }]),
            Asset.countDocuments(req.user.role === 'Employee' ? { employee: req.user.id } : {}),
            Notification.countDocuments({ recipient: req.user.id, readAt: null }),
            req.user.role === 'System Admin' ? User.countDocuments({ active: true }) : Promise.resolve(undefined),
        ])
        const open = ticketCounts.filter((item) => !['Resolved', 'Closed'].includes(item._id)).reduce((sum, item) => sum + item.count, 0)
        return res.json({ role: req.user.role, totalTickets: ticketCounts.reduce((sum, item) => sum + item.count, 0), openTickets: open, ticketCounts, priorityCounts, assets, unreadNotifications: unread, userCount })
    } catch (error) { return next(error) }
})

router.get('/notifications', async (req, res, next) => {
    try {
        const items = await Notification.find({ recipient: req.user.id }).sort({ createdAt: -1 }).limit(50)
        return res.json({ items, unread: items.filter((item) => !item.readAt).length })
    } catch (error) { return next(error) }
})
router.patch('/notifications/read-all', async (req, res, next) => {
    try { await Notification.updateMany({ recipient: req.user.id, readAt: null }, { readAt: new Date() }); return res.json({ success: true }) } catch (error) { return next(error) }
})
router.patch('/notifications/:id/read', async (req, res, next) => {
    try { const item = await Notification.findOneAndUpdate({ _id: req.params.id, recipient: req.user.id }, { readAt: new Date() }, { new: true }); return item ? res.json({ item }) : res.status(404).json({ error: { message: 'Notification not found' } }) } catch (error) { return next(error) }
})

router.get('/reports/summary', allowRoles('System Admin', 'IT Manager', 'Asset Manager'), async (req, res, next) => {
    try {
        const scope = req.user.role === 'IT Manager' ? { department: req.user.department } : {}
        const [statuses, priorities, assetStatuses, slaBreaches, recent] = await Promise.all([
            Ticket.aggregate([{ $match: scope }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
            Ticket.aggregate([{ $match: scope }, { $group: { _id: '$priority', count: { $sum: 1 } } }]),
            Asset.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
            Ticket.countDocuments({ ...scope, resolutionDueAt: { $lt: new Date() }, status: { $nin: ['Resolved', 'Closed'] } }),
            Ticket.find(scope).sort({ createdAt: -1 }).limit(10).select('ticketId title status priority createdAt'),
        ])
        return res.json({ statuses, priorities, assetStatuses, slaBreaches, recent })
    } catch (error) { return next(error) }
})

router.get('/audit', allowRoles('System Admin'), async (req, res, next) => {
    try { const items = await AuditLog.find().populate('user', 'name email').sort({ createdAt: -1 }).limit(100); return res.json({ items }) } catch (error) { return next(error) }
})

router.get('/worklogs', async (req, res, next) => {
    try {
        const filter = req.user.role === 'Technician' ? { technician: req.user.id } : {}
        const items = await WorkLog.find(filter).populate('ticket', 'ticketId title department').populate('technician', 'name').sort({ workedAt: -1 }).limit(100)
        return res.json({ items })
    } catch (error) { return next(error) }
})

router.patch('/assets/:id/assign', allowRoles('System Admin', 'Asset Manager'), async (req, res, next) => {
    try {
        const asset = await Asset.findById(req.params.id)
        if (!asset) return res.status(404).json({ error: { message: 'Asset not found' } })
        const employee = req.body.employee ? await User.findOne({ _id: req.body.employee, role: 'Employee', active: true }) : null
        if (req.body.employee && !employee) return res.status(404).json({ error: { message: 'Active employee not found' } })
        const previous = { employee: asset.employee, status: asset.status }
        asset.employee = employee?.id || null
        asset.department = employee?.department || null
        asset.status = employee ? 'Assigned' : 'Available'
        asset.history.push({ action: employee ? 'assigned' : 'unassigned', actor: req.user.id, employee: employee?.id, at: new Date() })
        await asset.save()
        await AuditLog.create({ user: req.user.id, action: employee ? 'assigned' : 'unassigned', entity: 'Asset', entityId: asset.id, previous, next: { employee: asset.employee, status: asset.status } })
        if (employee) await Notification.create({ recipient: employee.id, title: 'An asset was assigned to you', message: asset.name, type: 'asset', entityType: 'Asset', entityId: asset.id })
        return res.json({ item: asset })
    } catch (error) { return next(error) }
})

router.patch('/assets/:id/lifecycle', allowRoles('System Admin', 'Asset Manager'), async (req, res, next) => {
    try {
        const allowed = ['Available', 'Under Repair', 'Lost', 'Damaged', 'Retired']
        if (!allowed.includes(req.body.status)) return res.status(400).json({ error: { message: 'Invalid asset lifecycle status' } })
        const asset = await Asset.findById(req.params.id)
        if (!asset) return res.status(404).json({ error: { message: 'Asset not found' } })
        const previous = asset.status
        asset.status = req.body.status
        if (req.body.status !== 'Assigned') asset.employee = null
        asset.history.push({ action: req.body.status.toLowerCase(), actor: req.user.id, from: previous, to: req.body.status, at: new Date() })
        await asset.save()
        await AuditLog.create({ user: req.user.id, action: `asset ${req.body.status.toLowerCase()}`, entity: 'Asset', entityId: asset.id, previous, next: req.body.status })
        return res.json({ item: asset })
    } catch (error) { return next(error) }
})

for (const [path, config] of Object.entries(resources)) {
    const { model, write } = config
    router.get(`/${path}`, async (req, res, next) => {
        try {
            if (path === 'users' && req.user.role !== 'System Admin') return res.status(403).json({ error: { message: 'Only the System Admin can view users' } })
            const page = Math.max(1, Number(req.query.page) || 1)
            const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
            const filter = {}
            for (const field of ['status', 'role', 'department', 'type', 'priority']) if (req.query[field]) filter[field] = req.query[field]
            if (path === 'articles' && req.user.role === 'Employee') filter.status = 'Published'
            if (path === 'assets' && req.user.role === 'Employee') filter.employee = req.user.id
            if (req.query.search && ['assets', 'vendors', 'articles'].includes(path)) filter.$text = { $search: String(req.query.search).slice(0, 100) }
            const [items, total] = await Promise.all([model.find(filter).select(path === 'users' ? '-passwordHash' : undefined).sort({ createdAt: -1, name: 1 }).skip((page - 1) * limit).limit(limit), model.countDocuments(filter)])
            return res.json({ items, page, limit, total, pages: Math.ceil(total / limit) })
        } catch (error) { return next(error) }
    })
    router.post(`/${path}`, allowRoles(...write), async (req, res, next) => {
        try {
            let item
            if (path === 'users') {
                const { name, email, password, role, department, title } = req.body
                if (!name?.trim() || !email?.trim() || typeof password !== 'string' || !password || !['System Admin', 'IT Manager', 'Technician', 'Employee', 'Asset Manager'].includes(role)) {
                    return res.status(400).json({ error: { message: 'Name, email, valid role and password are required' } })
                }
                if (role === 'System Admin') return res.status(400).json({ error: { message: `The only System Admin account is ${systemAdminEmail}` } })
                item = await User.create({ name: name.trim(), email: email.trim().toLowerCase(), role, department, title, passwordHash: await bcrypt.hash(password, 12) })
            } else {
                item = await model.create(req.body)
            }
            const auditValue = path === 'users'
                ? { name: item.name, email: item.email, role: item.role, department: item.department, title: item.title }
                : item.toObject()
            await AuditLog.create({ user: req.user.id, action: 'created', entity: path, entityId: item.id, next: auditValue })
            return res.status(201).json({ item: path === 'users' ? await User.findById(item.id).select('-passwordHash') : item })
        } catch (error) { return next(error) }
    })
    router.patch(`/${path}/:id`, allowRoles(...write), async (req, res, next) => {
        try {
            const previous = await model.findById(req.params.id)
            if (!previous) return res.status(404).json({ error: { message: 'Record not found' } })
            const changes = path === 'users'
                ? Object.fromEntries(['name', 'email', 'role', 'department', 'title', 'phone', 'active'].filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]))
                : req.body
            if (path === 'users' && (changes.role || previous.role) === 'System Admin' && (changes.email || previous.email).toLowerCase() !== systemAdminEmail) {
                return res.status(400).json({ error: { message: `The System Admin account must use ${systemAdminEmail}` } })
            }
            if (path === 'users' && previous.role === 'System Admin' && previous.email === systemAdminEmail && ((changes.role && changes.role !== 'System Admin') || (changes.email && changes.email.toLowerCase() !== systemAdminEmail) || changes.active === false)) {
                return res.status(400).json({ error: { message: 'The sole System Admin account cannot be demoted, renamed or deactivated' } })
            }
            const item = await model.findByIdAndUpdate(req.params.id, { $set: changes }, { new: true, runValidators: true }).select(path === 'users' ? '-passwordHash' : undefined)
            await AuditLog.create({ user: req.user.id, action: 'updated', entity: path, entityId: item.id, previous: previous.toObject(), next: item.toObject() })
            return res.json({ item })
        } catch (error) { return next(error) }
    })
    router.delete(`/${path}/:id`, allowRoles(...write), async (req, res, next) => {
        try {
            const existing = await model.findById(req.params.id)
            if (path === 'users' && existing?.role === 'System Admin' && existing.email === systemAdminEmail) {
                return res.status(400).json({ error: { message: 'The sole System Admin account cannot be deleted' } })
            }
            const item = await model.findByIdAndDelete(req.params.id)
            if (!item) return res.status(404).json({ error: { message: 'Record not found' } })
            await AuditLog.create({ user: req.user.id, action: 'deleted', entity: path, entityId: item.id, previous: item.toObject() })
            return res.json({ success: true })
        } catch (error) { return next(error) }
    })
}

module.exports = router
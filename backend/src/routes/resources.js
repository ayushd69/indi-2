const express = require('express')
const bcrypt = require('bcryptjs')
const mongoose = require('mongoose')
const { allowRoles, authenticate } = require('../middleware/auth')
const { Asset, AssetRequest, AuditLog, Category, Counter, Department, KnowledgeArticle, Notification, SLA, Ticket, User, Vendor, WorkLog, systemAdminEmail } = require('../models')

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

router.get('/asset-requests', async (req, res, next) => {
    try {
        let filter = {}
        if (req.user.role === 'Employee') {
            filter.employee = req.user.id
        } else if (req.user.role === 'IT Manager') {
            const employees = req.user.department
                ? await User.find({ role: 'Employee', department: req.user.department, active: true }).select('_id')
                : []
            filter.employee = { $in: employees.map((employee) => employee.id) }
        } else if (!['System Admin', 'Asset Manager'].includes(req.user.role)) {
            return res.status(403).json({ error: { message: 'Your role cannot view asset requests' } })
        }
        const items = await AssetRequest.find(filter)
            .populate('asset', 'assetId name type brand status')
            .populate('employee', 'name email department')
            .populate('ticket', 'ticketId title status')
            .populate('reviewedBy', 'name role')
            .sort({ createdAt: -1 })
            .limit(200)
        return res.json({ items })
    } catch (error) { return next(error) }
})

router.post('/asset-requests', allowRoles('Employee'), async (req, res, next) => {
    try {
        const reason = String(req.body.reason || '').trim()
        if (!reason || reason.length > 1000) return res.status(400).json({ error: { message: 'Explain why you need the temporary asset (up to 1000 characters)' } })
        let ticket
        if (req.body.ticket) {
            ticket = await Ticket.findOne({ _id: req.body.ticket, employee: req.user.id })
            if (!ticket) return res.status(400).json({ error: { message: 'Choose one of your own support tickets' } })
        }
        const asset = await Asset.findOneAndUpdate(
            { _id: req.body.asset, status: 'Available' },
            { $set: { status: 'Requested', employee: null, department: null } },
            { new: true },
        )
        if (!asset) return res.status(409).json({ error: { message: 'This asset is no longer available. Refresh the list and choose an available item.' } })

        let request
        try {
            request = await AssetRequest.create({ asset: asset.id, employee: req.user.id, ticket: ticket?.id, reason })
        } catch (error) {
            await Asset.updateOne({ _id: asset.id, status: 'Requested' }, { $set: { status: 'Available' } })
            throw error
        }
        asset.history.push({ action: 'temporary asset requested', actor: req.user.id, request: request.id, at: new Date() })
        await asset.save()
        await AuditLog.create({ user: req.user.id, action: 'asset requested', entity: 'AssetRequest', entityId: request.id, next: { asset: asset.id, employee: req.user.id, ticket: ticket?.id } })
        const managers = await User.find({ active: true, role: { $in: ['Asset Manager', 'System Admin'] } }).select('_id')
        await Promise.all(managers.map((manager) => Notification.create({
            recipient: manager.id,
            title: `Temporary asset request from ${req.user.name}`,
            message: `${asset.name}: ${reason}`,
            type: 'asset',
            entityType: 'AssetRequest',
            entityId: request.id,
        })))
        return res.status(201).json({ item: await request.populate([
            { path: 'asset', select: 'assetId name type brand status' },
            { path: 'employee', select: 'name email department' },
            { path: 'ticket', select: 'ticketId title status' },
        ]) })
    } catch (error) { return next(error) }
})

router.patch('/asset-requests/:id/decision', allowRoles('System Admin', 'Asset Manager'), async (req, res, next) => {
    try {
        const request = await AssetRequest.findOne({ _id: req.params.id, status: 'Pending' })
        if (!request) return res.status(404).json({ error: { message: 'Pending asset request not found' } })
        const decision = req.body.decision
        const declineReason = String(req.body.reason || '').trim()
        if (!['approve', 'decline'].includes(decision)) return res.status(400).json({ error: { message: 'Choose approve or decline' } })
        if (declineReason.length > 1000) return res.status(400).json({ error: { message: 'Decline reason must be 1000 characters or less' } })

        const now = new Date()
        if (decision === 'approve') {
            const employee = await User.findOne({ _id: request.employee, role: 'Employee', active: true })
            if (!employee) return res.status(409).json({ error: { message: 'The requesting employee is no longer active' } })
            const asset = await Asset.findOneAndUpdate(
                { _id: request.asset, status: 'Requested' },
                { $set: { status: 'Assigned', employee: request.employee, department: employee.department || null } },
                { new: true },
            )
            if (!asset) return res.status(409).json({ error: { message: 'The asset is no longer awaiting approval' } })
            request.status = 'Approved'
            request.reviewedBy = req.user.id
            request.reviewedAt = now
            request.issuedAt = now
            try {
                await request.save()
                asset.history.push({ action: 'temporary asset issued', actor: req.user.id, employee: request.employee, request: request.id, at: now })
                await asset.save()
            } catch (error) {
                await Asset.updateOne({ _id: asset.id, status: 'Assigned', employee: request.employee }, { $set: { status: 'Requested', employee: null, department: null } })
                await AssetRequest.updateOne(
                    { _id: request.id, status: 'Approved' },
                    { $set: { status: 'Pending', reviewedBy: null, reviewedAt: null, issuedAt: null } },
                )
                throw error
            }
        } else {
            request.status = 'Declined'
            request.declineReason = declineReason || 'The request was not approved.'
            request.reviewedBy = req.user.id
            request.reviewedAt = now
            const declined = await AssetRequest.findOneAndUpdate(
                { _id: request.id, status: 'Pending' },
                { $set: { status: 'Declined', declineReason: request.declineReason, reviewedBy: req.user.id, reviewedAt: now } },
                { new: true },
            )
            if (!declined) return res.status(409).json({ error: { message: 'This asset request has already been reviewed' } })
            const released = await Asset.updateOne({ _id: request.asset, status: 'Requested' }, { $set: { status: 'Available' } })
            if (!released.modifiedCount) {
                await AssetRequest.updateOne({ _id: request.id, status: 'Declined' }, { $set: { status: 'Pending', declineReason: null, reviewedBy: null, reviewedAt: null } })
                return res.status(409).json({ error: { message: 'The asset is no longer awaiting approval' } })
            }
            request.status = 'Declined'
            await Asset.updateOne({ _id: request.asset }, { $push: { history: { action: 'temporary asset request declined', actor: req.user.id, request: request.id, at: now } } })
        }
        await AuditLog.create({ user: req.user.id, action: `asset request ${decision}d`, entity: 'AssetRequest', entityId: request.id, next: { status: request.status, reason: request.declineReason } })
        const asset = await Asset.findById(request.asset).select('name')
        await Notification.create({
            recipient: request.employee,
            title: decision === 'approve' ? 'Temporary asset approved and issued' : 'Temporary asset request declined',
            message: decision === 'approve' ? `${asset.name} was issued to you at ${now.toLocaleString()}.` : request.declineReason,
            type: 'asset',
            entityType: 'AssetRequest',
            entityId: request.id,
        })
        const employee = await User.findById(request.employee).select('department')
        if (decision === 'approve' && employee?.department) {
            const managers = await User.find({ role: 'IT Manager', department: employee.department, active: true }).select('_id')
            await Promise.all(managers.map((manager) => Notification.create({
                recipient: manager.id,
                title: 'Temporary equipment issued to an employee',
                message: `${asset.name} was issued to the employee at ${now.toLocaleString()}.`,
                type: 'asset',
                entityType: 'AssetRequest',
                entityId: request.id,
            })))
        }
        return res.json({ item: await request.populate([
            { path: 'asset', select: 'assetId name type brand status' },
            { path: 'employee', select: 'name email department' },
            { path: 'ticket', select: 'ticketId title status' },
            { path: 'reviewedBy', select: 'name role' },
        ]) })
    } catch (error) { return next(error) }
})

router.patch('/asset-requests/:id/return', allowRoles('Employee'), async (req, res, next) => {
    try {
        const request = await AssetRequest.findOneAndUpdate(
            { _id: req.params.id, employee: req.user.id, status: 'Approved' },
            { $set: { status: 'Return Requested' } },
            { new: true },
        ).populate('asset', 'name assetId')
        if (!request) return res.status(404).json({ error: { message: 'No active asset loan was found to return' } })
        await AuditLog.create({ user: req.user.id, action: 'asset return requested', entity: 'AssetRequest', entityId: request.id })
        const managers = await User.find({ active: true, role: { $in: ['Asset Manager', 'System Admin'] } }).select('_id')
        await Promise.all(managers.map((manager) => Notification.create({
            recipient: manager.id,
            title: `Asset return requested by ${req.user.name}`,
            message: `${request.asset.name} is ready to be received.`,
            type: 'asset',
            entityType: 'AssetRequest',
            entityId: request.id,
        })))
        const employee = await User.findById(request.employee).select('department')
        if (employee?.department) {
            const managers = await User.find({ role: 'IT Manager', department: employee.department, active: true }).select('_id')
            await Promise.all(managers.map((manager) => Notification.create({
                recipient: manager.id,
                title: 'Temporary asset return requested',
                message: `${request.asset.name} is ready to be received.`,
                type: 'asset',
                entityType: 'AssetRequest',
                entityId: request.id,
            })))
        }
        return res.json({ item: request })
    } catch (error) { return next(error) }
})

router.patch('/asset-requests/:id/receive', allowRoles('System Admin', 'Asset Manager'), async (req, res, next) => {
    try {
        const now = new Date()
        const request = await AssetRequest.findOneAndUpdate(
            { _id: req.params.id, status: 'Return Requested' },
            { $set: { status: 'Returned', returnedAt: now, reviewedBy: req.user.id, reviewedAt: now } },
            { new: true },
        )
        if (!request) return res.status(404).json({ error: { message: 'No return request is waiting to be received' } })
        const asset = await Asset.findOneAndUpdate(
            { _id: request.asset, status: 'Assigned', employee: request.employee },
            { $set: { status: 'Available', employee: null, department: null }, $push: { history: { action: 'temporary asset returned', actor: req.user.id, employee: request.employee, request: request.id, at: now } } },
            { new: true },
        )
        if (!asset) {
            await AssetRequest.updateOne({ _id: request.id, status: 'Returned' }, { $set: { status: 'Return Requested', returnedAt: null } })
            return res.status(409).json({ error: { message: 'The asset is not currently assigned to this employee' } })
        }
        await AuditLog.create({ user: req.user.id, action: 'asset returned', entity: 'AssetRequest', entityId: request.id, next: { returnedAt: now, asset: asset.id } })
        await Notification.create({
            recipient: request.employee,
            title: 'Temporary asset returned',
            message: `${asset.name} was received by the Asset Manager at ${now.toLocaleString()} and is available again.`,
            type: 'asset',
            entityType: 'AssetRequest',
            entityId: request.id,
        })
        const employee = await User.findById(request.employee).select('department')
        if (employee?.department) {
            const managers = await User.find({ role: 'IT Manager', department: employee.department, active: true }).select('_id')
            await Promise.all(managers.map((manager) => Notification.create({
                recipient: manager.id,
                title: 'Temporary equipment returned',
                message: `${asset.name} was received at ${now.toLocaleString()}.`,
                type: 'asset',
                entityType: 'AssetRequest',
                entityId: request.id,
            })))
        }
        return res.json({ item: await request.populate([
            { path: 'asset', select: 'assetId name type brand status' },
            { path: 'employee', select: 'name email department' },
            { path: 'ticket', select: 'ticketId title status' },
            { path: 'reviewedBy', select: 'name role' },
        ]) })
    } catch (error) { return next(error) }
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
        if (await AssetRequest.exists({ asset: asset.id, status: { $in: ['Pending', 'Approved', 'Return Requested'] } })) {
            return res.status(409).json({ error: { message: 'This asset has an active temporary request or loan. Use the request and return workflow instead.' } })
        }
        const employee = req.body.employee ? await User.findOne({ _id: req.body.employee, role: 'Employee', active: true }) : null
        if (req.body.employee && !employee) return res.status(404).json({ error: { message: 'Active employee not found' } })
        const now = new Date()
        const previous = { employee: asset.employee, status: asset.status }
        const nextStatus = employee ? 'Assigned' : 'Available'
        const updated = await Asset.findOneAndUpdate(
            { _id: asset.id, status: employee ? 'Available' : asset.status },
            {
                $set: { employee: employee?.id || null, department: employee?.department || null, status: nextStatus },
                $push: { history: { action: employee ? 'assigned' : 'unassigned', actor: req.user.id, employee: employee?.id, at: now } },
            },
            { new: true },
        )
        if (!updated) return res.status(409).json({ error: { message: 'This asset is no longer available to assign' } })
        await AuditLog.create({ user: req.user.id, action: employee ? 'assigned' : 'unassigned', entity: 'Asset', entityId: updated.id, previous, next: { employee: updated.employee, status: updated.status } })
        if (employee) await Notification.create({ recipient: employee.id, title: 'An asset was assigned to you', message: asset.name, type: 'asset', entityType: 'Asset', entityId: asset.id })
        return res.json({ item: updated })
    } catch (error) { return next(error) }
})

router.patch('/assets/:id/lifecycle', allowRoles('System Admin', 'Asset Manager'), async (req, res, next) => {
    try {
        const allowed = ['Available', 'Under Repair', 'Lost', 'Damaged', 'Retired']
        if (!allowed.includes(req.body.status)) return res.status(400).json({ error: { message: 'Invalid asset lifecycle status' } })
        const asset = await Asset.findById(req.params.id)
        if (!asset) return res.status(404).json({ error: { message: 'Asset not found' } })
        if (['Requested', 'Assigned'].includes(asset.status) && await AssetRequest.exists({ asset: asset.id, status: { $in: ['Pending', 'Approved', 'Return Requested'] } })) {
            return res.status(409).json({ error: { message: 'This asset has an active request or loan. Complete that workflow before changing its lifecycle.' } })
        }
        const previous = asset.status
        const updated = await Asset.findOneAndUpdate(
            { _id: asset.id, status: previous },
            {
                $set: { status: req.body.status, employee: null, department: null },
                $push: { history: { action: req.body.status.toLowerCase(), actor: req.user.id, from: previous, to: req.body.status, at: new Date() } },
            },
            { new: true },
        )
        if (!updated) return res.status(409).json({ error: { message: 'The asset changed while updating. Refresh and try again.' } })
        await AuditLog.create({ user: req.user.id, action: `asset ${req.body.status.toLowerCase()}`, entity: 'Asset', entityId: updated.id, previous, next: req.body.status })
        return res.json({ item: updated })
    } catch (error) { return next(error) }
})

for (const [path, config] of Object.entries(resources)) {
    const { model, write } = config
    router.get(`/${path}`, async (req, res, next) => {
        try {
            if (path === 'users' && req.user.role !== 'System Admin') return res.status(403).json({ error: { message: 'Only the System Admin can view users' } })
            const page = Math.max(1, Number(req.query.page) || 1)
            const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
            let filter = {}
            for (const field of ['status', 'role', 'department', 'type', 'priority']) if (req.query[field]) filter[field] = req.query[field]
            if (path === 'articles' && req.user.role === 'Employee') filter.status = 'Published'
            if (path === 'assets' && req.user.role === 'Employee') filter = { $or: [{ status: 'Available' }, { employee: req.user.id }] }
            if (path === 'assets' && req.user.role === 'IT Manager') {
                const employees = req.user.department
                    ? await User.find({ role: 'Employee', department: req.user.department, active: true }).select('_id')
                    : []
                filter = { $or: [{ status: 'Available' }, { employee: { $in: employees.map((employee) => employee.id) } }] }
            }
            if (req.query.search && ['assets', 'vendors', 'articles'].includes(path)) filter.$text = { $search: String(req.query.search).slice(0, 100) }
            const query = model.find(filter).select(path === 'users' ? '-passwordHash' : undefined)
            if (path === 'assets') query.populate('employee', 'name email').populate('department', 'name')
            const [items, total] = await Promise.all([query.sort({ createdAt: -1, name: 1 }).skip((page - 1) * limit).limit(limit), model.countDocuments(filter)])
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
                if (path === 'assets') {
                    const assetFields = ['assetId', 'name', 'type', 'category', 'brand', 'model', 'serialNumber', 'purchaseDate', 'purchasePrice', 'vendor', 'warrantyStart', 'warrantyEnd', 'location', 'condition', 'notes']
                    const asset = Object.fromEntries(assetFields.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]))
                    if (!asset.assetId) {
                        const existingIds = await Asset.find({ assetId: /^AST-\d+$/ }).select('assetId')
                        const highest = existingIds.reduce((value, current) => Math.max(value, Number(current.assetId.match(/\d+$/)?.[0]) || 0), 0)
                        await Counter.updateOne({ _id: 'asset' }, { $max: { value: highest } }, { upsert: true })
                        const sequence = await Counter.findByIdAndUpdate('asset', { $inc: { value: 1 } }, { upsert: true, new: true })
                        asset.assetId = `AST-${String(sequence.value).padStart(6, '0')}`
                    } else {
                        asset.assetId = String(asset.assetId).trim()
                    }
                    asset.status = 'Available'
                    item = await model.create(asset)
                } else {
                item = await model.create(req.body)
                }
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
                : path === 'assets'
                    ? Object.fromEntries(['assetId', 'name', 'type', 'category', 'brand', 'model', 'serialNumber', 'purchaseDate', 'purchasePrice', 'vendor', 'warrantyStart', 'warrantyEnd', 'location', 'condition', 'notes'].filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]))
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
            if (path === 'assets' && await AssetRequest.exists({ asset: req.params.id })) {
                return res.status(409).json({ error: { message: 'Assets with request or loan history cannot be deleted' } })
            }
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
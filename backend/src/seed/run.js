const bcrypt = require('bcryptjs')
const mongoose = require('mongoose')
const connectDatabase = require('../config/database')
const { Asset, AssetRequest, AuditLog, Category, Comment, Counter, Department, KnowledgeArticle, Notification, SLA, Ticket, User, WorkLog, systemAdminEmail } = require('../models')

async function run() {
    await connectDatabase()
    const activeRequests = await AssetRequest.find({ status: { $in: ['Pending', 'Approved', 'Return Requested'] } }).select('asset employee')
    for (const request of activeRequests) {
        const released = await Asset.findOneAndUpdate(
            {
                _id: request.asset,
                $or: [
                    { status: 'Requested' },
                    { status: 'Assigned', employee: request.employee },
                ],
            },
            {
                $set: { status: 'Available', employee: null, department: null },
                $push: { history: { action: 'temporary loan cleared during demo reset', at: new Date() } },
            },
        )
        if (released) console.info(`Released temporary loan asset ${released.assetId}`)
    }
    await Promise.all([
        AssetRequest.deleteMany({}),
        Comment.deleteMany({}),
        Ticket.deleteMany({}),
        WorkLog.deleteMany({}),
        AuditLog.deleteMany({ entity: { $in: ['Ticket', 'AssetRequest'] } }),
        Notification.deleteMany({ entityType: { $in: ['Ticket', 'AssetRequest'] } }),
        Counter.deleteMany({ _id: 'ticket' }),
    ])
    await mongoose.connection.collection('vendors').deleteMany({})
    await Asset.updateMany({}, { $unset: { vendor: '' } })

    const departments = {}
    for (const name of ['IT', 'HR', 'Finance', 'Marketing', 'Sales', 'Operations']) {
        departments[name] = await Department.findOneAndUpdate({ name }, { $setOnInsert: { name } }, { upsert: true, new: true })
    }
    const adminPasswordHash = await bcrypt.hash('system@123', 12)
    let existingAdmin = await User.findOne({ email: systemAdminEmail })
    if (!existingAdmin) {
        existingAdmin = await User.findOne({ email: 'admin@servicedesk.com', role: 'System Admin' })
        if (existingAdmin) {
            existingAdmin.email = systemAdminEmail
            await existingAdmin.save()
        }
    }
    const users = {
        'System Admin': await User.findOneAndUpdate({ email: systemAdminEmail }, { $set: { email: systemAdminEmail, role: 'System Admin', name: 'Ayush Darne', department: departments.IT.id, passwordHash: adminPasswordHash, title: 'System Admin', active: true } }, { upsert: true, new: true }),
    }
    const accounts = [
        ['manager@servicedesk.com', 'IT Manager', 'Jordan Lee', 'IT'],
        ['technician@servicedesk.com', 'Technician', 'Sam Patel', 'IT'],
        ['employee@servicedesk.com', 'Employee', 'Taylor Kim', 'Finance'],
        ['assetmanager@servicedesk.com', 'Asset Manager', 'Riley Chen', 'IT'],
    ]
    const passwordHash = await bcrypt.hash('ServiceDesk!2026', 12)
    for (const [email, role, name, department] of accounts) {
        users[role] = await User.findOneAndUpdate({ email }, { $setOnInsert: { email, role, name, department: departments[department].id, passwordHash, title: role } }, { upsert: true, new: true })
    }
    const categoryNames = [
        'Hardware',
        'Software',
        'Network',
        'Email',
        'Security',
        'Access Management',
        'Printer',
        'VPN',
        'Laptop',
        'Headset',
        'Mouse',
        'CPU / Desktop',
        'Keyboard',
        'Monitor',
        'Webcam',
        'Docking Station',
        'Tablet',
        'Mobile Phone',
        'Other',
    ]
    const categories = {}
    for (const name of categoryNames) categories[name] = await Category.findOneAndUpdate({ name }, { $setOnInsert: { name, subcategories: [name === 'Hardware' ? 'Laptop' : name === 'Network' ? 'Connectivity' : 'General'], active: true } }, { upsert: true, new: true })
    const slaByPriority = {}
    for (const [priority, responseMinutes, resolutionMinutes] of [['Low', 480, 2880], ['Medium', 240, 1440], ['High', 60, 480], ['Critical', 15, 120]]) {
        slaByPriority[priority] = await SLA.findOneAndUpdate({ name: `${priority} priority`, priority }, { $setOnInsert: { name: `${priority} priority`, priority, responseMinutes, resolutionMinutes, active: true } }, { upsert: true, new: true })
    }
    const catalog = [
        ['AST-000001', 'ThinkPad X1 Carbon', 'Laptop', 'Lenovo', 'SDP-DEMO-001'],
        ['AST-000002', 'Dell UltraSharp 27', 'Monitor', 'Dell', 'SDP-DEMO-002'],
        ['AST-000003', 'Latitude 5450', 'Laptop', 'Dell', 'SDP-DEMO-003'],
        ['AST-000004', 'ProBook 440 G10', 'Laptop', 'HP', 'SDP-DEMO-004'],
        ['AST-000005', 'USB-C Docking Station', 'Dock', 'Lenovo', 'SDP-DEMO-005'],
        ['AST-000006', 'Noise-cancelling Headset', 'Headset', 'Jabra', 'SDP-DEMO-006'],
        ['AST-000007', 'Wireless Keyboard and Mouse Set', 'Peripherals', 'Logitech', 'SDP-DEMO-007'],
        ['AST-000008', '1080p Webcam', 'Webcam', 'Logitech', 'SDP-DEMO-008'],
        ['AST-000009', 'EliteBook 840 G10', 'Laptop', 'HP', 'SDP-DEMO-009'],
        ['AST-000010', 'ThinkVision T24i-30', 'Monitor', 'Lenovo', 'SDP-DEMO-010'],
        ['AST-000011', 'USB-C Universal Dock', 'Dock', 'Dell', 'SDP-DEMO-011'],
        ['AST-000012', 'Jabra Evolve2 40 Headset', 'Headset', 'Jabra', 'SDP-DEMO-012'],
        ['AST-000013', 'MX Master 3S Mouse', 'Mouse', 'Logitech', 'SDP-DEMO-013'],
        ['AST-000014', 'K380 Bluetooth Keyboard', 'Keyboard', 'Logitech', 'SDP-DEMO-014'],
        ['AST-000015', 'Portable 1TB SSD', 'Storage', 'Samsung', 'SDP-DEMO-015'],
        ['AST-000016', '1080p USB Conference Camera', 'Webcam', 'Logitech', 'SDP-DEMO-016'],
    ]
    for (const [assetId, name, type, brand, serialNumber] of catalog) {
        await Asset.findOneAndUpdate(
            { assetId },
            { $setOnInsert: { assetId, name, type, brand, serialNumber, status: 'Available', condition: 'Good' } },
            { upsert: true, new: true },
        )
    }
    await KnowledgeArticle.findOneAndUpdate({ title: 'Reconnect to the company VPN' }, { $setOnInsert: { title: 'Reconnect to the company VPN', category: 'VPN', problem: 'VPN connection fails after a password change.', solution: 'Remove the saved VPN credentials, sign in with your current password, then reconnect.', tags: ['vpn', 'password', 'network'], author: users.Technician.id, status: 'Published' } }, { upsert: true })
    console.info(`Demo data refreshed: tickets and asset requests cleared, users and existing assets retained, and ${catalog.length} catalog assets ensured. System Admin: ${systemAdminEmail} / system@123. Other demo accounts use password: ServiceDesk!2026`)
    await require('mongoose').disconnect()
}

run().catch(async (error) => { console.error(error); await require('mongoose').disconnect(); process.exitCode = 1 })
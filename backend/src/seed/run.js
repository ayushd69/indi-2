const bcrypt = require('bcryptjs')
const connectDatabase = require('../config/database')
const { Asset, Category, Counter, Department, KnowledgeArticle, SLA, Ticket, User, Vendor, systemAdminEmail } = require('../models')

async function run() {
    await connectDatabase()
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
    await User.updateMany({ role: 'System Admin', email: { $ne: systemAdminEmail } }, { $set: { role: 'Employee' } })
    const users = {
        'System Admin': await User.findOneAndUpdate({ email: systemAdminEmail }, { $set: { email: systemAdminEmail, role: 'System Admin', name: 'Avery Morgan', department: departments.IT.id, passwordHash: adminPasswordHash, title: 'System Admin', active: true } }, { upsert: true, new: true }),
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
    const categoryNames = ['Hardware', 'Software', 'Network', 'Email', 'Security', 'Access Management', 'Printer', 'VPN', 'Other']
    const categories = {}
    for (const name of categoryNames) categories[name] = await Category.findOneAndUpdate({ name }, { $setOnInsert: { name, subcategories: [name === 'Hardware' ? 'Laptop' : name === 'Network' ? 'Connectivity' : 'General'], active: true } }, { upsert: true, new: true })
    const slaByPriority = {}
    for (const [priority, responseMinutes, resolutionMinutes] of [['Low', 480, 2880], ['Medium', 240, 1440], ['High', 60, 480], ['Critical', 15, 120]]) {
        slaByPriority[priority] = await SLA.findOneAndUpdate({ name: `${priority} priority`, priority }, { $setOnInsert: { name: `${priority} priority`, priority, responseMinutes, resolutionMinutes, active: true } }, { upsert: true, new: true })
    }
    const vendor = await Vendor.findOneAndUpdate({ name: 'Northstar Technology' }, { $setOnInsert: { name: 'Northstar Technology', contactPerson: 'Morgan Blake', email: 'support@northstar.example', productsServices: ['Laptops', 'Warranty repair'] } }, { upsert: true, new: true })
    await Asset.findOneAndUpdate({ assetId: 'AST-000001' }, { $setOnInsert: { assetId: 'AST-000001', name: 'ThinkPad X1 Carbon', type: 'Laptop', brand: 'Lenovo', status: 'Assigned', employee: users.Employee.id, department: departments.Finance.id, vendor: vendor.id, warrantyEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180), serialNumber: 'SDP-DEMO-001' } }, { upsert: true })
    await Asset.findOneAndUpdate({ assetId: 'AST-000002' }, { $setOnInsert: { assetId: 'AST-000002', name: 'Dell UltraSharp 27', type: 'Monitor', brand: 'Dell', status: 'Available', vendor: vendor.id, serialNumber: 'SDP-DEMO-002' } }, { upsert: true })
    await KnowledgeArticle.findOneAndUpdate({ title: 'Reconnect to the company VPN' }, { $setOnInsert: { title: 'Reconnect to the company VPN', category: 'VPN', problem: 'VPN connection fails after a password change.', solution: 'Remove the saved VPN credentials, sign in with your current password, then reconnect.', tags: ['vpn', 'password', 'network'], author: users.Technician.id, status: 'Published' } }, { upsert: true })
    const samples = [
        ['VPN disconnects after sign-in', 'The VPN client closes shortly after I connect from home.', 'High', 'VPN', 'In Progress', users.Technician.id],
        ['Laptop camera is not detected', 'The camera stopped appearing in video meeting apps this morning.', 'Medium', 'Hardware', 'Open', null],
        ['Request access to finance folder', 'Please restore my access to the quarterly planning folder.', 'Low', 'Access Management', 'Resolved', users.Technician.id],
    ]
    for (let index = 0; index < samples.length; index += 1) {
        const [title, description, priority, category, status, assignedTo] = samples[index]
        const ticketId = `SD-${new Date().getFullYear()}-${String(index + 1).padStart(6, '0')}`
        await Ticket.findOneAndUpdate({ ticketId }, { $setOnInsert: { ticketId, title, description, priority, status, category: categories[category].id, employee: users.Employee.id, department: departments.Finance.id, assignedTo, sla: slaByPriority[priority].id, responseDueAt: new Date(Date.now() + 1000 * 60 * 60), resolutionDueAt: new Date(Date.now() + 1000 * 60 * 60 * 8), history: [] } }, { upsert: true })
    }
    const currentYear = new Date().getFullYear()
    const yearTickets = await Ticket.find({ ticketId: new RegExp(`^SD-${currentYear}-\\d+$`) }).select('ticketId')
    const highestTicketNumber = yearTickets.reduce((highest, ticket) => Math.max(highest, Number(ticket.ticketId.split('-').at(-1)) || 0), samples.length)
    await Counter.findByIdAndUpdate('ticket', { $max: { value: highestTicketNumber } }, { upsert: true, new: true })
    console.info(`Demo data ready. System Admin: ${systemAdminEmail} / system@123. Other demo accounts use password: ServiceDesk!2026`)
    await require('mongoose').disconnect()
}

run().catch(async (error) => { console.error(error); await require('mongoose').disconnect(); process.exitCode = 1 })
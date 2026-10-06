const { AuditLog, Notification, Ticket, User } = require('../models')

async function checkSLAs() {
    const now = new Date()
    const riskBoundary = new Date(now.getTime() + 30 * 60 * 1000)
    const atRisk = await Ticket.find({ status: { $nin: ['Resolved', 'Closed', 'Escalated'] }, resolutionDueAt: { $gt: now, $lte: riskBoundary }, slaRiskNotifiedAt: null })
    for (const ticket of atRisk) {
        ticket.slaRiskNotifiedAt = now
        await ticket.save()
        const recipients = [ticket.assignedTo, ...(await User.find({ role: 'IT Manager', department: ticket.department }).distinct('_id'))].filter(Boolean)
        await Notification.insertMany(recipients.map((recipient) => ({ recipient, title: `SLA at risk: ${ticket.ticketId}`, message: ticket.title, type: 'sla', entityType: 'Ticket', entityId: ticket.id })))
    }
    const breached = await Ticket.find({ status: { $nin: ['Resolved', 'Closed', 'Escalated'] }, resolutionDueAt: { $lte: now } })
    for (const ticket of breached) {
        const previous = ticket.status
        ticket.status = 'Escalated'
        ticket.history.push({ action: 'automatic SLA escalation', from: previous, to: 'Escalated', at: now })
        await ticket.save()
        await AuditLog.create({ action: 'automatic SLA escalation', entity: 'Ticket', entityId: ticket.id, previous, next: 'Escalated' })
        const recipients = [ticket.assignedTo, ...(await User.find({ role: { $in: ['IT Manager', 'System Admin'] }, department: ticket.department }).distinct('_id'))].filter(Boolean)
        await Notification.insertMany(recipients.map((recipient) => ({ recipient, title: `SLA breached: ${ticket.ticketId}`, message: 'Ticket automatically escalated after missing its resolution target.', type: 'sla', entityType: 'Ticket', entityId: ticket.id })))
    }
}

module.exports = checkSLAs
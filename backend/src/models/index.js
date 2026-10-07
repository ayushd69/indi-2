const mongoose = require('mongoose')

const { Schema } = mongoose
const roles = ['System Admin', 'IT Manager', 'Technician', 'Employee', 'Asset Manager']
const systemAdminEmail = 'system@gmail.com'
const baseOptions = { timestamps: true, strict: false }

const userSchema = new Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: roles, default: 'Employee' },
    department: { type: Schema.Types.ObjectId, ref: 'Department' },
    title: String,
    phone: String,
    active: { type: Boolean, default: true },
})
userSchema.index({ department: 1, role: 1 })

const departmentSchema = new Schema({ name: { type: String, required: true, unique: true }, description: String, manager: { type: Schema.Types.ObjectId, ref: 'User' } }, baseOptions)
const categorySchema = new Schema({ name: { type: String, required: true, unique: true }, subcategories: [String], active: { type: Boolean, default: true } }, baseOptions)
const slaSchema = new Schema({ name: { type: String, required: true }, priority: String, responseMinutes: Number, resolutionMinutes: Number, businessHoursOnly: { type: Boolean, default: false }, active: { type: Boolean, default: true } }, baseOptions)
const commentSchema = new Schema({ ticket: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true }, author: { type: Schema.Types.ObjectId, ref: 'User', required: true }, body: { type: String, required: true }, internal: { type: Boolean, default: false }, attachments: [Schema.Types.Mixed] }, baseOptions)
const workLogSchema = new Schema({ ticket: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true }, technician: { type: Schema.Types.ObjectId, ref: 'User', required: true }, description: { type: String, required: true }, minutes: { type: Number, min: 1, required: true }, workedAt: { type: Date, default: Date.now } }, baseOptions)
const assetRequestSchema = new Schema({
    asset: { type: Schema.Types.ObjectId, ref: 'Asset', required: true },
    employee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ticket: { type: Schema.Types.ObjectId, ref: 'Ticket' },
    reason: { type: String, required: true, maxlength: 1000 },
    status: { type: String, enum: ['Pending', 'Approved', 'Declined', 'Return Requested', 'Returned'], default: 'Pending' },
    declineReason: { type: String, maxlength: 1000 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    issuedAt: Date,
    returnedAt: Date,
}, baseOptions)
assetRequestSchema.index({ asset: 1, status: 1 })
assetRequestSchema.index({ employee: 1, createdAt: -1 })
const ticketSchema = new Schema({
    ticketId: { type: String, unique: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    employee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department' },
    category: { type: Schema.Types.ObjectId, ref: 'Category' },
    subcategory: String,
    priority: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' },
    status: { type: String, enum: ['Open', 'Assigned', 'In Progress', 'Pending', 'Escalated', 'Resolved', 'Closed', 'Reopened'], default: 'Open' },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    assignmentRequests: [{
        technician: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        status: { type: String, enum: ['Pending', 'Accepted', 'Declined'], required: true },
        reason: String,
        requestedAt: { type: Date, default: Date.now },
        respondedAt: Date,
    }],
    sla: { type: Schema.Types.ObjectId, ref: 'SLA' },
    responseDueAt: Date,
    resolutionDueAt: Date,
    attachments: [Schema.Types.Mixed],
    history: [{ actor: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed, at: { type: Date, default: Date.now } }],
    resolvedAt: Date,
}, baseOptions)
ticketSchema.index({ status: 1, priority: 1, department: 1, createdAt: -1 })
ticketSchema.index({ title: 'text', description: 'text', ticketId: 'text' })

const assetSchema = new Schema({ assetId: { type: String, unique: true }, name: { type: String, required: true }, type: String, category: String, brand: String, model: String, serialNumber: String, purchaseDate: Date, purchasePrice: Number, warrantyStart: Date, warrantyEnd: Date, employee: { type: Schema.Types.ObjectId, ref: 'User' }, department: { type: Schema.Types.ObjectId, ref: 'Department' }, location: String, condition: String, status: { type: String, enum: ['Available', 'Requested', 'Assigned', 'Under Repair', 'Lost', 'Damaged', 'Retired'], default: 'Available' }, notes: String, history: [Schema.Types.Mixed] }, baseOptions)
const articleSchema = new Schema({ title: { type: String, required: true }, category: String, problem: String, solution: String, tags: [String], author: { type: Schema.Types.ObjectId, ref: 'User' }, status: { type: String, enum: ['Draft', 'Published', 'Archived'], default: 'Draft' } }, baseOptions)
articleSchema.index({ title: 'text', problem: 'text', solution: 'text', tags: 'text' })
const notificationSchema = new Schema({ recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true }, title: String, message: String, type: String, entityType: String, entityId: Schema.Types.ObjectId, readAt: Date }, baseOptions)
const auditSchema = new Schema({ user: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, entity: String, entityId: Schema.Types.ObjectId, previous: Schema.Types.Mixed, next: Schema.Types.Mixed }, baseOptions)
const counterSchema = new Schema({ _id: String, value: { type: Number, default: 0 } })

function model(name, schema) {
    return mongoose.models[name] || mongoose.model(name, schema)
}

module.exports = {
    AuditLog: model('AuditLog', auditSchema),
    Category: model('Category', categorySchema),
    Comment: model('Comment', commentSchema),
    Counter: model('Counter', counterSchema),
    Department: model('Department', departmentSchema),
    KnowledgeArticle: model('KnowledgeArticle', articleSchema),
    Notification: model('Notification', notificationSchema),
    SLA: model('SLA', slaSchema),
    Ticket: model('Ticket', ticketSchema),
    User: model('User', userSchema),
    WorkLog: model('WorkLog', workLogSchema),
    Asset: model('Asset', assetSchema),
    AssetRequest: model('AssetRequest', assetRequestSchema),
    roles,
    systemAdminEmail,
}
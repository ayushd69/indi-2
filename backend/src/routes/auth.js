const bcrypt = require('bcryptjs')
const express = require('express')
const jwt = require('jsonwebtoken')
const { jwtSecret } = require('../config/env')
const { authenticate } = require('../middleware/auth')
const { Department, User, roles, systemAdminEmail } = require('../models')

const router = express.Router()
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role, requestedRole: user.requestedRole, department: user.department, title: user.title })

function issueToken(user) {
    const departmentId = user.department?._id?.toString() || user.department?.toString()
    return jwt.sign({ sub: user.id, role: user.role, department: departmentId }, jwtSecret, { expiresIn: '12h' })
}

router.post('/login', async (req, res, next) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase()
        const user = await User.findOne({ email }).select('+passwordHash').populate('department', 'name')
        if (!user || !user.active || (user.role === 'System Admin' && user.email !== systemAdminEmail) || !(await bcrypt.compare(String(req.body.password || ''), user.passwordHash))) {
            return res.status(401).json({ error: { message: 'Email or password is incorrect' } })
        }
        return res.json({ token: issueToken(user), user: publicUser(user) })
    } catch (error) { return next(error) }
})

router.post('/register', async (req, res, next) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {}
        const name = String(body.name || '').trim()
        const email = String(body.email || '').trim().toLowerCase()
        const password = String(body.password || '')
        const requestedRole = body.role || 'Employee'
        const registrableRoles = ['Employee', 'Technician', 'IT Manager', 'Asset Manager']
        if (name.length < 2 || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
            return res.status(400).json({ error: { message: 'Enter a name, valid email, and password between 8 and 72 bytes.' } })
        }
        if (!registrableRoles.includes(requestedRole)) {
            return res.status(400).json({ error: { message: 'Choose a valid account role.' } })
        }
        if (email === systemAdminEmail) {
            return res.status(409).json({ error: { message: 'This email address cannot be registered.' } })
        }
        if (await User.exists({ email })) {
            return res.status(409).json({ error: { message: 'An account with this email already exists.' } })
        }

        const user = await User.create({
            name,
            email,
            passwordHash: await bcrypt.hash(password, 12),
            role: 'Employee',
            title: 'Employee',
            ...(requestedRole !== 'Employee' ? { requestedRole } : {}),
        })
        const message = requestedRole === 'Employee'
            ? 'Account created with Employee access.'
            : `Account created with Employee access. Your ${requestedRole} role request is pending admin approval.`
        return res.status(201).json({ token: issueToken(user), user: publicUser(user), message })
    } catch (error) { return next(error) }
})

router.get('/me', authenticate, async (req, res, next) => {
    try {
        await req.user.populate('department', 'name')
        return res.json({ user: publicUser(req.user) })
    } catch (error) { return next(error) }
})

router.get('/roles', authenticate, (req, res) => res.json({ roles }))
router.get('/departments', async (req, res, next) => {
    try { return res.json({ items: await Department.find().select('name') }) } catch (error) { return next(error) }
})

module.exports = router
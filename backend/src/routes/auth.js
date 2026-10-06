const bcrypt = require('bcryptjs')
const express = require('express')
const jwt = require('jsonwebtoken')
const { jwtSecret } = require('../config/env')
const { authenticate } = require('../middleware/auth')
const { Department, User, roles, systemAdminEmail } = require('../models')

const router = express.Router()
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role, department: user.department, title: user.title })

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

router.post('/register', (req, res) => {
    return res.status(403).json({ error: { message: 'Self-registration is disabled. Contact the System Admin to create an account.' } })
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
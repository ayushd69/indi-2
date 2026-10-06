const jwt = require('jsonwebtoken')
const { jwtSecret } = require('../config/env')
const { User, systemAdminEmail } = require('../models')

async function authenticate(req, res, next) {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return res.status(401).json({ error: { message: 'Authentication required' } })

    try {
        const payload = jwt.verify(token, jwtSecret)
        const user = await User.findById(payload.sub).select('-passwordHash')
        if (!user || !user.active || (user.role === 'System Admin' && user.email !== systemAdminEmail)) return res.status(401).json({ error: { message: 'Session is no longer valid' } })
        req.user = user
        return next()
    } catch {
        return res.status(401).json({ error: { message: 'Invalid or expired session' } })
    }
}

function allowRoles(...allowed) {
    return (req, res, next) => allowed.includes(req.user.role)
        ? next()
        : res.status(403).json({ error: { message: 'Your role cannot perform this action' } })
}

module.exports = { allowRoles, authenticate }
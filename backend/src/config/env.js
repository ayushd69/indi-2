const path = require('node:path')
const dotenv = require('dotenv')

dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const configuredJwtSecret = process.env.JWT_SECRET
if (process.env.NODE_ENV === 'production' && (!configuredJwtSecret || configuredJwtSecret.length < 32)) {
    throw new Error('Production requires a JWT_SECRET of at least 32 characters')
}

module.exports = {
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
    aiApiKey: process.env.AI_API_KEY,
    aiApiUrl: process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions',
    aiModel: process.env.AI_MODEL || 'gpt-4o-mini',
    jwtSecret: configuredJwtSecret || 'development-only-change-this-secret',
    mongoUri: process.env.MONGODB_URI,
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT) || 5000,
}
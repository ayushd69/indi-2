const mongoose = require('mongoose')
const { mongoUri } = require('./env')

async function connectDatabase() {
    if (!mongoUri) {
        throw new Error('MONGODB_URI is required. Copy backend/.env.example to backend/.env.')
    }

    await mongoose.connect(mongoUri)
    console.info('MongoDB connected')
}

module.exports = connectDatabase
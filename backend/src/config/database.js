const mongoose = require('mongoose')
const { mongoUri } = require('./env')

let connectionPromise

async function connectDatabase() {
    if (mongoose.connection.readyState === 1) return

    if (!mongoUri) {
        throw new Error('MONGODB_URI is required. Copy backend/.env.example to backend/.env.')
    }

    if (!connectionPromise) {
        connectionPromise = mongoose.connect(mongoUri)
            .then(() => console.info('MongoDB connected'))
            .finally(() => {
                connectionPromise = undefined
            })
    }

    await connectionPromise
}

module.exports = connectDatabase
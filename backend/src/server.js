const app = require('./app')
const connectDatabase = require('./config/database')
const { port } = require('./config/env')
const checkSLAs = require('./services/slaMonitor')

async function startServer() {
    await connectDatabase()

    const server = app.listen(port, () => {
        console.info(`ServiceDesk Pro API listening on port ${port}`)
    })
    const slaTimer = setInterval(() => checkSLAs().catch((error) => console.error(`SLA monitor: ${error.message}`)), 60 * 1000)
    slaTimer.unref()

    function shutdown() {
        clearInterval(slaTimer)
        server.close(() => {
            process.exit(0)
        })
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
}

startServer().catch((error) => {
    console.error(`Unable to start API: ${error.message}`)
    process.exit(1)
})
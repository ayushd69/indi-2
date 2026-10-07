const express = require('express')
const app = require('./app')
const connectDatabase = require('./config/database')
const { errorHandler } = require('./middleware/errorHandler')

const vercelApp = express()

vercelApp.use(async (req, res, next) => {
    try {
        await connectDatabase()
        return next()
    } catch (error) {
        return next(error)
    }
})
vercelApp.use(app)
vercelApp.use(errorHandler)

module.exports = vercelApp

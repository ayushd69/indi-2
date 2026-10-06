function notFoundHandler(req, res) {
    res.status(404).json({
        error: { message: `Route ${req.method} ${req.originalUrl} was not found` },
    })
}

function errorHandler(error, req, res, next) {
    if (res.headersSent) {
        return next(error)
    }

    const status = error.code === 11000 ? 409 : error.name === 'ValidationError' || error.name === 'CastError' ? 400 : error.status || 500
    const message = status >= 500 ? 'An unexpected server error occurred' : error.code === 11000 ? 'A record with this value already exists' : error.message

    if (status >= 500) {
        console.error(error)
    }

    return res.status(status).json({ error: { message } })
}

module.exports = { errorHandler, notFoundHandler }
const assert = require('node:assert/strict')
const { after, before, test } = require('node:test')
const app = require('../src/app')

let server
let baseUrl

before(async () => {
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
    })
})

test('health reports a disconnected database and includes security headers', async () => {
    const response = await fetch(`${baseUrl}/api/health`)
    const payload = await response.json()

    assert.equal(response.status, 503)
    assert.equal(payload.status, 'degraded')
    assert.equal(payload.database, 'disconnected')
    assert.equal(payload.service, 'ServiceDesk Pro API')
    assert.equal(response.headers.get('x-powered-by'), null)
    assert.ok(response.headers.has('x-content-type-options'))
})

test('public registration rejects invalid data before database access', async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'New User', email: 'not-an-email', password: 'short' }),
    })
    const payload = await response.json()

    assert.equal(response.status, 400)
    assert.match(payload.error.message, /valid email/i)
})

test('public registration rejects a body without account fields', async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '[]',
    })
    const payload = await response.json()

    assert.equal(response.status, 400)
    assert.match(payload.error.message, /name, valid email/i)
})

test('user creation requires authentication', async () => {
    const response = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'New User', email: 'new@example.com', password: 'long-enough-password', role: 'Employee' }),
    })
    const payload = await response.json()

    assert.equal(response.status, 401)
    assert.match(payload.error.message, /authentication required/i)
})
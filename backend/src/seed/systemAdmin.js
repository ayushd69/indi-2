const bcrypt = require('bcryptjs')
const mongoose = require('mongoose')
const connectDatabase = require('../config/database')
const { Department, User, systemAdminEmail } = require('../models')

async function run() {
    const password = process.env.ADMIN_INITIAL_PASSWORD
    if (!password || password.length < 8) {
        throw new Error('Set ADMIN_INITIAL_PASSWORD to a password of at least 8 characters.')
    }

    await connectDatabase()
    const department = await Department.findOneAndUpdate(
        { name: 'IT' },
        { $setOnInsert: { name: 'IT' } },
        { upsert: true, new: true },
    )
    const passwordHash = await bcrypt.hash(password, 12)

    await User.findOneAndUpdate(
        { email: systemAdminEmail },
        {
            $set: {
                name: 'Ayush Darne',
                email: systemAdminEmail,
                role: 'System Admin',
                department: department.id,
                passwordHash,
                title: 'System Admin',
                active: true,
            },
        },
        { upsert: true, new: true, runValidators: true },
    )

    console.info(`System Admin account is ready for ${systemAdminEmail}.`)
}

run()
    .catch((error) => {
        console.error(`Unable to provision System Admin: ${error.message}`)
        process.exitCode = 1
    })
    .finally(async () => {
        await mongoose.disconnect()
    })

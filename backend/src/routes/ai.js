const express = require('express')
const { aiApiKey, aiApiUrl, aiModel } = require('../config/env')
const { authenticate } = require('../middleware/auth')
const { KnowledgeArticle } = require('../models')

const router = express.Router()
router.use(authenticate)

router.post('/suggest', async (req, res, next) => {
    try {
        const title = String(req.body.title || '').slice(0, 500)
        const description = String(req.body.description || '').slice(0, 8000)
        if (!title && !description) return res.status(400).json({ error: { message: 'Provide a title or description for suggestions' } })
        let suggestion = { category: 'Other', priority: 'Medium', probableIssue: 'Review the request details', summary: `${title} ${description}`.trim().slice(0, 240) }
        if (aiApiKey) {
            const response = await fetch(aiApiUrl, { method: 'POST', headers: { authorization: `Bearer ${aiApiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: aiModel, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Return JSON only with category, priority (Low, Medium, High, Critical), probableIssue, summary. Suggestions only; never claim to have taken an action.' }, { role: 'user', content: `Ticket title: ${title}\nDescription: ${description}` }] }) })
            if (!response.ok) return res.status(502).json({ error: { message: 'AI suggestion provider is unavailable' } })
            const payload = await response.json()
            suggestion = JSON.parse(payload.choices?.[0]?.message?.content || '{}')
        } else {
            const content = `${title} ${description}`.toLowerCase()
            if (/vpn|network|wifi|internet/.test(content)) suggestion.category = 'Network'
            else if (/password|login|access|account/.test(content)) suggestion.category = 'Access Management'
            else if (/laptop|screen|keyboard|printer|monitor/.test(content)) suggestion.category = 'Hardware'
            if (/urgent|cannot work|outage|all users|security/.test(content)) suggestion.priority = 'High'
            if (content.length > 360) suggestion.summary = `${content.slice(0, 357)}...`
        }
        const recommendations = await KnowledgeArticle.find({ status: 'Published', $text: { $search: `${title} ${description}`.slice(0, 200) } }).select('title category tags').limit(3).catch(() => [])
        return res.json({ suggestion, recommendations, requiresReview: true })
    } catch (error) { return next(error) }
})

module.exports = router
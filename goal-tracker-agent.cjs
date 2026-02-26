#!/usr/bin/env node
/**
 * goal-tracker-agent.js — Phase 3: Smart AI Behavior
 * ═══════════════════════════════════════════════════════════
 * P2P AI Goal Tracker Agent for Intercom (Trac Network fork)
 *
 * AGENT BEHAVIOR SUMMARY (for SKILL.md):
 *   This agent is a collaborative P2P goal tracker. It connects
 *   to Intercom's SC-Bridge, joins sidechannels, and acts as an
 *   always-on coaching companion. It parses goals from natural
 *   language, tracks progress with persistence, auto-generates
 *   category-aware motivational tips, suggests milestones for
 *   large goals, and cheers peers on progress updates with a
 *   natural, randomized tone. It responds helpfully and positively.
 *
 * PHASE 4: Streak Tracking & Auto-Reminders
 *   • streak: 🔥 counters for daily updates
 *   • auto-reminders: hourly check for inactive goals (>24h since last update)
 *   • streaks are calculated on UTC days
 *
 * NOTE: Milestones and buddy pairing are NOT included as per Phase 4 requirements.
 *
 * HOW TO RUN:
 *   pear run . --sc-bridge 1 --sc-bridge-token TOKEN --sidechannels goals,reminders,goal-updates
 *   SC_BRIDGE_TOKEN=TOKEN node goal-tracker-agent.js
 *
 * ENV VARS: SC_BRIDGE_WS, SC_BRIDGE_TOKEN, GOALS_CHANNEL, GOALS_FILE, DEBUG
 * DEPS: ws (npm install ws), fs (built-in)
 * ═══════════════════════════════════════════════════════════
 */
'use strict'
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

// ─── §1 Configuration ───────────────────────────────────
const CONFIG = {
    wsUrl: process.env.SC_BRIDGE_WS || 'ws://127.0.0.1:49222',
    token: process.env.SC_BRIDGE_TOKEN || '',
    channel: process.env.GOALS_CHANNEL || 'goals',
    goalsFile: process.env.GOALS_FILE || path.join(__dirname, 'goals.json'),
    extraChannels: ['reminders', 'goal-updates'],
    reconnectBaseMs: 5000, reconnectMaxMs: 60000, maxReconnectAttempts: 30,
    peerId: 'agent-' + Math.random().toString(36).slice(2, 8),
    // PHASE 3: Rate limiting
    autoReplyChance: 1.0,        // 100% for testing (usually 0.4)
    tipCooldownMs: 15000,        // Lowered to 15s for better feedback
    peerReplyCooldownMs: 5000    // Lowered to 5s for better feedback
}

// ─── §2 Logging ──────────────────────────────────────────
const TAG = '[GoalAgent]'
function ts() { return new Date().toISOString().slice(11, 23) }
function logInfo(...a) { console.log(ts(), TAG, 'ℹ️ ', ...a) }
function logOk(...a) { console.log(ts(), TAG, '✅', ...a) }
function logWarn(...a) { console.warn(ts(), TAG, '⚠️ ', ...a) }
function logError(...a) { console.error(ts(), TAG, '❌', ...a) }
function logDebug(...a) { if (process.env.DEBUG) console.log(ts(), TAG, '🔍', ...a) }
function logNet(...a) { console.log(ts(), TAG, '🌐', ...a) }

// ─── §3 Goal Storage ────────────────────────────────────
let goals = {}
let goalCounter = 0

function loadGoals() {
    try {
        if (fs.existsSync(CONFIG.goalsFile)) {
            const d = JSON.parse(fs.readFileSync(CONFIG.goalsFile, 'utf-8'))
            goals = d.goals || {}; goalCounter = d.counter || 0
            logOk(`Loaded ${Object.keys(goals).length} goal(s)`)
        } else { logInfo('No goals file — starting fresh') }
    } catch (e) { logError('Load goals failed:', e.message); goals = {}; goalCounter = 0 }
}

function saveGoals() {
    try { fs.writeFileSync(CONFIG.goalsFile, JSON.stringify({ goals, counter: goalCounter }, null, 2), 'utf-8') }
    catch (e) { logError('Save goals failed:', e.message) }
}

function nextGoalId() { goalCounter++; return 'g' + String(goalCounter).padStart(3, '0') }

// ─── §4 Input Parsing ───────────────────────────────────
function parseGoalInput(raw) {
    if (!raw || typeof raw !== 'string') return null
    const text = raw.trim()
    const setM = text.match(/^(?:set\s+goal|new\s+goal|goal)\s*:\s*(.+)/i)
    if (setM) return parseGoalBody(setM[1].trim())
    const progM = text.match(/^(?:update\s+progress|progress|update)\s*:\s*(g\d{3})\s+\+?(\d{1,3})%?/i)
    if (progM) return { command: 'update', args: { id: progM[1].toLowerCase(), progress: Math.min(100, Math.max(0, parseInt(progM[2], 10))) } }
    if (/^list\s+goals?/i.test(text)) return { command: 'list', args: {} }
    const statM = text.match(/^(?:goal\s+)?status\s*:\s*(g\d{3})/i)
    if (statM) return { command: 'status', args: { id: statM[1].toLowerCase() } }
    const remM = text.match(/^(?:remove|delete)\s+goal\s*:\s*(g\d{3})/i)
    if (remM) return { command: 'remove', args: { id: remM[1].toLowerCase() } }
    if (/^help$/i.test(text)) return { command: 'help', args: {} }
    return null
}

function parseGoalBody(body) {
    let desc = body, deadline = '', target = ''
    const byM = body.match(/\s+by\s+(.+)$/i)
    if (byM) { deadline = byM[1].trim(); desc = body.slice(0, byM.index).trim() }
    const inM = body.match(/\s+in\s+(\d+\s+\w+)$/i)
    if (!deadline && inM) { deadline = inM[1].trim(); desc = body.slice(0, inM.index).trim() }
    const monM = desc.match(/([$€£]\s?[\d,]+(?:\.\d{1,2})?)/)
    if (monM) target = monM[1]
    else { const nM = desc.match(/(\d+(?:\.\d+)?\s*[a-z%]*)/i); if (nM) target = nM[1].trim() }
    return { command: 'set', args: { description: desc, target: target || desc, deadline: deadline || 'No specific deadline' } }
}

// ─── §5 Goal Mutations ──────────────────────────────────
function createGoal(description, target, deadline, forceId) {
    const id = forceId || nextGoalId()
    if (goals[id]) { logDebug(`Goal ${id} exists — skip`); return goals[id] }
    const goal = {
        id, description, target, deadline, progress: 0, history: [], createdAt: Date.now(), status: 'active',
        streak: 0, lastUpdateDate: null, lastReminderDate: null // PHASE 4: Streak & Reminders
    }
    goals[id] = goal; saveGoals()
    logOk(`Goal created: ${id} — "${description}"`)
    return goal
}

function updateProgress(id, percent) {
    const goal = goals[id]
    if (!goal) { logWarn(`Goal not found: ${id}`); return null }
    if (goal.status !== 'active') { logWarn(`Goal ${id} already ${goal.status}`); return null }
    const old = goal.progress
    goal.progress = Math.min(100, Math.max(0, percent))

    // ─── Streak Tracking (PHASE 4) ───
    const today = new Date().toISOString().split('T')[0]
    if (!goal.streak) goal.streak = 0
    if (!goal.lastUpdateDate) {
        goal.streak = 1
        goal.lastUpdateDate = today
    } else if (today !== goal.lastUpdateDate) {
        const last = new Date(goal.lastUpdateDate)
        const nextDay = new Date(last)
        nextDay.setUTCDate(nextDay.getUTCDate() + 1)
        const nextDayStr = nextDay.toISOString().split('T')[0]

        if (today === nextDayStr) {
            goal.streak += 1
        } else {
            goal.streak = 1
        }
        goal.lastUpdateDate = today
    }

    goal.history.push({ timestamp: Date.now(), progress: goal.progress, note: `${old}% → ${goal.progress}%`, streak: goal.streak })
    if (goal.progress >= 100) { goal.progress = 100; goal.status = 'completed'; logOk(`🎉 Goal ${id} COMPLETED`) }
    else { logOk(`Goal ${id}: ${old}% → ${goal.progress}% (Streak: ${goal.streak})`) }
    saveGoals(); return goal
}

function removeGoal(id) {
    if (!goals[id]) return false
    delete goals[id]; saveGoals(); logOk(`Goal removed: ${id}`); return true
}

// ─── §6 PHASE 3: Goal Categorization ────────────────────
// NEW: Keyword-based classification for category-specific tips.
const CATEGORY_KEYWORDS = {
    finance: ['save', 'earn', 'invest', 'budget', 'money', '$', '€', '£', 'income', 'debt', 'pay', 'savings', 'salary', 'expense'],
    fitness: ['run', 'walk', 'gym', 'workout', 'exercise', 'mile', 'km', 'kg', 'lbs', 'push-up', 'pushup', 'plank', 'swim', 'bike', 'steps', 'weight', 'lose', 'gain', 'jog', 'lift', 'squat'],
    learning: ['read', 'book', 'study', 'learn', 'course', 'chapter', 'lesson', 'practice', 'code', 'write', 'certificate', 'exam', 'skill', 'tutorial'],
    wellness: ['meditate', 'sleep', 'water', 'hydrate', 'journal', 'gratitude', 'mindful', 'relax', 'stretch', 'yoga']
}

/**
 * PHASE 3: Categorize a goal by scanning its text for keywords.
 * @param {Object} goal
 * @returns {'finance'|'fitness'|'learning'|'wellness'|'general'}
 */
function categorizeGoal(goal) {
    const text = `${goal.description} ${goal.target} ${goal.raw || ''}`.toLowerCase()
    for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
        if (kws.some(kw => text.includes(kw))) return cat
    }
    return 'general'
}

// ─── §7 PHASE 3: Smart Tip Generator (rewritten) ────────
// Category-aware, progress-bracket, deadline-proximity tips.

/** Days until deadline (null if no deadline). */
function daysUntilDeadline(goal) {
    if (!goal.deadline || goal.deadline === 'No specific deadline') return null
    const d = new Date(goal.deadline)
    if (isNaN(d.getTime())) return null
    return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000))
}

// Tip banks: [category][bracket] → string[]
const TIP_BANKS = {
    finance: {
        start: [
            '💰 Every dollar saved is a dollar earned. Start tracking daily expenses!',
            '📊 Try the 50/30/20 rule: 50% needs, 30% wants, 20% savings.',
            '🏦 Set up an automatic transfer — even $10/week builds momentum.',
            '☕ One daily habit change (home coffee?) could free up $50+/month.',
            '📱 Review your subscriptions today — cancel what you don\'t use.'
        ],
        momentum: [
            '📈 You\'re building real savings habits. Consistency is everything!',
            '💡 Consider a no-spend weekend to boost your progress.',
            '🔄 Look into cashback apps or rewards programs for bonus savings.',
            '🎯 You\'re past the hardest part. The middle is where habits solidify.'
        ],
        finish: [
            '🔥 The finish line is in sight! Don\'t dip into your progress now.',
            '🏁 Almost there — any items you can sell for a final push?',
            '🏆 Your future self is going to love you for this discipline.',
            '💎 So close! Consider one last side hustle sprint.'
        ]
    },
    fitness: {
        start: [
            '🏃 Start small — 15 min/day builds the habit. Intensity comes later.',
            '🥇 Your body is adapting. The first weeks are the hardest!',
            '🎧 Fresh playlist or podcast can make workouts something you crave.',
            '📝 Log every session. Seeing your streak grow is powerful motivation.',
            '💧 Hydration matters! Drink water before, during, and after.'
        ],
        momentum: [
            '💪 Your body is changing even if the mirror hasn\'t caught up yet.',
            '🥗 Fuel matters — nutrition is 80% of the results.',
            '👟 Mix up your routine to avoid plateaus. Cross-training helps!',
            '🧘 Rest days prevent burnout. Recovery IS part of training.'
        ],
        finish: [
            '⚡ You\'re in beast mode! The discipline you\'ve built is permanent.',
            '🏆 Elite consistency. Finish and set a bigger goal!',
            '📸 Take a progress photo — you\'ll be amazed looking back.',
            '🥇 Almost there! Visualize crossing that finish line.'
        ]
    },
    learning: {
        start: [
            '📚 20 minutes daily compounds into mastery. Start the timer!',
            '🧠 Break it into micro-tasks. One chapter/lesson at a time.',
            '✏️ Active notes boost retention by 50%. Summarize in your own words.',
            '🎯 Start with the hardest material when energy is highest.',
            '🔄 Spaced repetition prevents forgetting. Review yesterday\'s notes.'
        ],
        momentum: [
            '💡 Try teaching what you\'ve learned — it\'s the #1 retention hack.',
            '📝 Keep a "learning log" — one key insight per session.',
            '🗣️ Discuss with others — social learning accelerates growth.',
            '📊 Track completed vs remaining. Visible progress fuels more progress.'
        ],
        finish: [
            '🎓 Almost done! Reflect on how much you\'ve grown.',
            '🚀 Finish strong and plan what\'s next — momentum is powerful.',
            '🌟 Don\'t rush the last stretch — depth beats speed.',
            '📗 You\'re about to complete something most people abandon.'
        ]
    },
    wellness: {
        start: [
            '🌿 Small daily habits create lasting change. You\'ve started — biggest step!',
            '💧 Track daily check-ins. Consistency beats perfection.',
            '✨ Pair your new habit with an existing one (habit stacking).',
            '🧘 Focus on how you FEEL, not just numbers. Wellness is holistic.'
        ],
        momentum: [
            '🌱 Your new habit is taking root. Keep nurturing it.',
            '📱 It takes ~66 days to make a habit automatic. You\'re building!',
            '💚 Notice the small improvements in mood and energy.',
            '🎵 Create a calming ritual around your wellness practice.'
        ],
        finish: [
            '🏆 You\'ve built a real lifestyle change!',
            '🌟 Start planning your next wellness goal — momentum is powerful.',
            '💫 Small steps created a big transformation. Celebrate!',
            '☀️ This is now part of who you are. Beautiful work.'
        ]
    },
    general: {
        start: [
            '🎯 Every journey starts with step one. You\'re already here!',
            '📅 Break it into weekly milestones. Small wins keep motivation high.',
            '🧩 Focus on systems, not just outcomes. The right daily habit wins.',
            '⏰ Block dedicated time. What gets scheduled gets done.',
            '📌 Write your "why" somewhere visible. Purpose fuels persistence.'
        ],
        momentum: [
            '📈 Real momentum now! You\'re past the "giving up" zone.',
            '🔄 Review what\'s working and double down on it.',
            '💪 Your future self is already thanking you.',
            '🧠 Remember WHY you started. Reconnect with your purpose.'
        ],
        finish: [
            '🔥 Sprint to the finish! You\'ve earned this.',
            '🏁 The end is RIGHT THERE. Don\'t slow down!',
            '💎 Too much invested to stop. Finish what you started!',
            '⚡ One last push and this goal is DONE.'
        ]
    }
}

// Urgency overlays (applied when deadline is close)
const URGENCY_TIPS = [
    '⚠️ Deadline in {days} days — time to intensify!',
    '⏳ Only {days} days left! Every hour counts now.',
    '🔴 {days} days remaining — lock in and focus!',
    '⏰ Clock is ticking: {days} days. You can do this — push!'
]

/**
 * PHASE 3: Completely rewritten tip generator.
 * Category-aware + progress-bracket + deadline-proximity.
 */
function generateTip(goal) {
    const p = goal.progress
    const cat = categorizeGoal(goal)

    if (goal.status === 'completed') {
        return pick(['🏆 Incredible! You crushed it!', '🎉 Goal achieved! Celebrate!', '🌟 100%! What\'s next?', '💪 Champion! Discipline > motivation.'], goal.id)
    }

    // Progress bracket
    let bracket = 'start'
    if (p >= 30 && p < 70) bracket = 'momentum'
    else if (p >= 70) bracket = 'finish'

    logDebug(`Tip for goal ${goal.id}: cat=${cat}, bracket=${bracket}, progress=${p}%`)

    const bank = (TIP_BANKS[cat] && TIP_BANKS[cat][bracket]) || TIP_BANKS.general[bracket]
    let tip = pick(bank)

    // PHASE 3: Deadline urgency overlay
    const daysLeft = daysUntilDeadline(goal)
    if (daysLeft !== null && daysLeft <= 7 && goal.status === 'active') {
        const urgency = URGENCY_TIPS[Math.floor(Math.random() * URGENCY_TIPS.length)]
            .replace('{days}', String(daysLeft))
        tip = urgency + ' ' + tip
    }

    // PHASE 3: Sprinkle progress percentage naturally
    if (p > 0 && Math.random() > 0.5) {
        tip = `[${p}%] ` + tip
    }

    return tip
}

function generateRandomTip() {
    const active = Object.values(goals).filter(g => g.status === 'active')
    if (active.length === 0) {
        return { goalId: null, tip: '🎯 No active goals. Set one with "Set goal: <description>"!' }
    }
    const goal = active[Math.floor(Math.random() * active.length)]
    return { goalId: goal.id, tip: generateTip(goal) }
}

function pick(pool) {
    if (!pool || pool.length === 0) return '🎯 Keep going!'
    return pool[Math.floor(Math.random() * pool.length)]
}

// ─── §8 PHASE 4: Auto-Reminders ──────────────────────────
let reminderInterval = null
function startReminders() {
    if (reminderInterval) return
    logInfo('Starting auto-reminders interval (hourly)')
    reminderInterval = setInterval(() => {
        const now = new Date()
        Object.values(goals).forEach(goal => {
            if (goal.status !== 'active' || goal.progress >= 100) return

            const lastRem = goal.lastReminderDate ? new Date(goal.lastReminderDate) : null
            const hoursSinceLast = lastRem ? (now - lastRem) / 3600000 : 999

            if (hoursSinceLast >= 24) {
                const streak = goal.streak || 0
                const reminderText = `Keep your 🔥 ${streak}-day streak alive! Update progress on "${goal.description}" today.`
                logInfo(`Sending reminder for goal ${goal.id}`)
                sendToChannel(JSON.stringify({
                    action: 'reminder',
                    goalId: goal.id,
                    message: reminderText,
                    originPeer: CONFIG.peerId,
                    timestamp: now.getTime()
                }), CONFIG.channel)
                goal.lastReminderDate = now.toISOString()
                saveGoals()
            }
        })
    }, 3600000)
}

// ─── §9 PHASE 3: Peer Encouragement (NEW) ───────────────
// Rate limiting state
let lastAutoTipTime = 0
let lastPeerReplyTime = 0
let mutationCount = 0

const PEER_CHEERS = [
    'Nice one, {peer}! You\'re inspiring the group. 🔥',
    'Awesome progress, {peer}! Keep that energy going! 💪',
    '{peer} is crushing it at {progress}%! Who\'s next? 🚀',
    'Way to go, {peer}! Every step forward counts. 🌟',
    'Love seeing this progress, {peer}! You\'re on fire! 🎯',
    'That\'s what dedication looks like, {peer}! 🏆',
    '{peer} just moved to {progress}% — incredible momentum! 📈',
    'Shoutout to {peer} for staying consistent! 👏'
]

/**
 * PHASE 3: Generate a natural, encouraging response to a peer's update.
 *
 * @param {Object} peerUpdate  { from, goalId, progress, description }
 * @returns {string}
 */
function generateResponseToPeer(peerUpdate) {
    const peer = peerUpdate.from || peerUpdate.sender || 'peer'
    const peerName = String(peer).slice(0, 8)
    const progress = peerUpdate.progress || 0

    // Pick a cheer template
    let cheer = PEER_CHEERS[Math.floor(Math.random() * PEER_CHEERS.length)]
    cheer = cheer.replace(/\{peer\}/g, peerName).replace(/\{progress\}/g, String(progress))

    // Add a relevant tip if we have the goal locally
    const localGoal = goals[peerUpdate.goalId]
    if (localGoal) {
        const tip = generateTip(localGoal)
        cheer += `\n💡 ${tip}`
    }

    return cheer
}

/**
 * PHASE 3: Decide whether to auto-reply to a peer update.
 * Returns true ~40% of the time, rate-limited.
 */
function shouldAutoReplyToPeer() {
    const now = Date.now()
    if (now - lastPeerReplyTime < CONFIG.peerReplyCooldownMs) return false
    return Math.random() < CONFIG.autoReplyChance
}

/**
 * PHASE 3: Maybe send an auto-tip after local mutations.
 * Triggers on every mutation for testing, rate-limited.
 */
function maybeAutoTip(channel) {
    mutationCount++
    // if (mutationCount % 3 !== 0) return 
    const now = Date.now()
    if (now - lastAutoTipTime < CONFIG.tipCooldownMs) return
    lastAutoTipTime = now
    const { tip } = generateRandomTip()
    logOk('Auto-tip triggered: ' + tip.slice(0, 80))
    sendToChannel(`🤖 ${tip}`, channel)
}

// ─── §10 Response Formatters ─────────────────────────────
function formatGoalCard(goal) {
    const bar = progressBar(goal.progress)
    const cat = categorizeGoal(goal)
    const tip = generateTip(goal)
    const icon = { active: '🔵', completed: '🟢', failed: '🔴' }[goal.status] || '⚪'
    return [
        `${icon} [${goal.id}] ${goal.description}`,
        `   Category: ${cat} | Target: ${goal.target} | Deadline: ${goal.deadline}`,
        `   Progress: ${bar} ${goal.progress}%  [${goal.status}]`,
        `   💡 ${tip}`
    ].join('\n')
}
function progressBar(p) { const f = Math.round(Math.min(100, Math.max(0, p)) / 5); return `[${'█'.repeat(f)}${'░'.repeat(20 - f)}]` }
function helpText() {
    return [
        '📖 Goal Tracker Agent v3 — Commands',
        '─'.repeat(44), '',
        '  Set goal: <desc> [by <deadline>]     — Create a new goal',
        '  Update progress: <id> <pct>%         — Log progress',
        '  List goals                           — Show all goals',
        '  Goal status: <id>                    — Detail view',
        '  Remove goal: <id>                    — Delete a goal',
        '  Help                                 — This message', '',
        '  JSON: { "action": "set_goal"|"update_progress"|"tip_request"|"list_goals"|"remove_goal", ... }', '',
        '─'.repeat(44),
        '🤖 I auto-generate tips, track streaks, and cheer peers!'
    ].join('\n')
}

// ─── §11 SC-Bridge Communication ────────────────────────
let ws = null, authenticated = false, reconnectAttempts = 0, reconnectTimer = null

function sendMessage(msg) {
    if (!ws || ws.readyState !== WebSocket.OPEN) { logWarn('WS not open'); return false }
    try { const p = JSON.stringify(msg); ws.send(p); logDebug('→', p.slice(0, 250)); return true }
    catch (e) { logError('Send failed:', e.message); return false }
}
function sendToChannel(content, channel) {
    return sendMessage({ type: 'send', channel: channel || CONFIG.channel, message: typeof content === 'string' ? content : JSON.stringify(content) })
}
function broadcastUpdate(action, goalData, tip) {
    const payload = { action, originPeer: CONFIG.peerId, timestamp: Date.now(), goal: { id: goalData.id, description: goalData.description, target: goalData.target, deadline: goalData.deadline, progress: goalData.progress, status: goalData.status, streak: goalData.streak } }
    if (tip) payload.tip = tip
    const s = JSON.stringify(payload)
    sendToChannel(s, CONFIG.channel)
    for (const ch of CONFIG.extraChannels) sendToChannel(s, ch)
    logNet(`Broadcast [${action}] → ${goalData.id}`)
}

// ─── §12 Auth & Join ─────────────────────────────────────
function authenticate() {
    if (!CONFIG.token) { logError('SC_BRIDGE_TOKEN required!'); process.exit(1) }
    logInfo('Authenticating...'); sendMessage({ type: 'auth', token: CONFIG.token })
}
function joinChannels() {
    for (const ch of [CONFIG.channel, ...CONFIG.extraChannels]) {
        logInfo(`Joining "${ch}"`)
        sendMessage({ type: 'join', channel: ch })
        sendMessage({ type: 'subscribe', channels: [ch] })
    }
}
function onAuthenticated() {
    logOk('Authenticated ✔'); authenticated = true; joinChannels()
    sendToChannel(JSON.stringify({ action: 'agent_status', originPeer: CONFIG.peerId, agent: 'goal-tracker-v4', status: 'online', timestamp: Date.now(), goalsTracked: Object.keys(goals).length }))
    logOk(`Online — ${Object.keys(goals).length} goal(s)`)
    startReminders() // Start hourly check
}

// ─── §13 JSON Action Handler (PHASE 3: enhanced) ────────
function handleJsonAction(data, channel) {
    if (!data || !data.action) return false
    if (data.originPeer === CONFIG.peerId) { logDebug('Skip own echo'); return true }

    switch (data.action) {
        case 'set_goal': {
            const desc = data.description || ''; if (!desc) { sendToChannel(JSON.stringify({ action: 'error', originPeer: CONFIG.peerId, message: 'set_goal needs description' }), channel); return true }
            const goal = createGoal(desc, data.target || desc, data.deadline || 'No specific deadline', data.goalId || null)
            const tip = generateTip(goal)
            logOk(`Created goal [${goal.id}] for peer and generated tip: "${tip.slice(0, 50)}..."`)
            broadcastUpdate('goal_created', goal, tip)
            sendToChannel(`✅ [${goal.id}] ${goal.description}\n💡 ${tip}`, channel)
            maybeAutoTip(channel)
            return true
        }
        case 'update_progress': {
            const id = data.goalId || data.id || ''; const prog = Number(data.progress)
            if (!id || isNaN(prog)) { sendToChannel(JSON.stringify({ action: 'error', originPeer: CONFIG.peerId, message: 'Need goalId + progress' }), channel); return true }
            const goal = updateProgress(id, prog)
            if (!goal) { sendToChannel(JSON.stringify({ action: 'error', originPeer: CONFIG.peerId, message: `Goal "${id}" not found/inactive` }), channel); return true }
            const tip = generateTip(goal)
            logOk(`Updated goal [${id}] to ${prog}% and generated tip: "${tip.slice(0, 50)}..."`)
            broadcastUpdate('progress_updated', goal, tip)
            sendToChannel(`📊 [${goal.id}] ${goal.description}: ${progressBar(goal.progress)} ${goal.progress}%\n💡 ${tip}`, channel)
            // PHASE 3: Auto-reply with peer encouragement (probabilistic)
            if (shouldAutoReplyToPeer()) {
                lastPeerReplyTime = Date.now()
                const cheer = generateResponseToPeer({ from: data.originPeer || data.sender, goalId: id, progress: prog, description: goal.description })
                sendToChannel(cheer, channel)
                logNet(`Auto-cheer sent to ${data.sender || 'peer'} ✔`)
            }
            maybeAutoTip(channel)
            return true
        }
        case 'tip_request': {
            const { goalId, tip } = generateRandomTip()
            sendToChannel(JSON.stringify({ action: 'tip_response', originPeer: CONFIG.peerId, goalId, tip, timestamp: Date.now() }), channel)
            sendToChannel(tip, channel)
            return true
        }
        case 'list_goals': {
            sendToChannel(JSON.stringify({ action: 'goals_list', originPeer: CONFIG.peerId, goals: Object.values(goals).map(g => ({ id: g.id, description: g.description, target: g.target, deadline: g.deadline, progress: g.progress, status: g.status, category: categorizeGoal(g), streak: g.streak || 0 })), count: Object.keys(goals).length, timestamp: Date.now() }), channel)
            return true
        }
        case 'remove_goal': {
            const id = data.goalId || ''; const ok = removeGoal(id)
            sendToChannel(JSON.stringify({ action: 'goal_removed', originPeer: CONFIG.peerId, goalId: id, success: ok, timestamp: Date.now() }), channel)
            return true
        }
        case 'agent_status': { logNet(`Peer ${data.agent || '?'} → ${data.status || '?'}`); return true }
        case 'goal_created': case 'progress_updated': case 'tip_response': case 'goals_list': case 'goal_removed': case 'error':
            logDebug(`Peer response: ${data.action}`); return true
        default: logDebug(`Unknown action: "${data.action}"`); return false
    }
}

// ─── §14 Plaintext Dispatcher (PHASE 3: enhanced) ───────
function dispatchCommand(parsed, channel) {
    const { command, args } = parsed
    switch (command) {
        case 'set': {
            const goal = createGoal(args.description, args.target, args.deadline)
            const tip = generateTip(goal)
            broadcastUpdate('goal_created', goal, tip)
            maybeAutoTip(channel)
            return `✅ Goal created: [${goal.id}] ${goal.description}\n   Target: ${goal.target} | Deadline: ${goal.deadline}\n   💡 ${tip}`
        }
        case 'update': {
            const goal = updateProgress(args.id, args.progress)
            if (!goal) return `❌ Goal "${args.id}" not found or inactive.`
            const tip = generateTip(goal)
            broadcastUpdate('progress_updated', goal, tip)
            maybeAutoTip(channel)
            return `📊 [${goal.id}] ${goal.description}: ${progressBar(goal.progress)} ${goal.progress}%\n   💡 ${tip}`
        }
        case 'list': {
            const all = Object.values(goals)
            if (!all.length) return '📋 No goals yet. Use "Set goal: <description>"!'
            return [`📋 Goals (${all.length}):`, '─'.repeat(44), ...all.map(g => formatGoalCard(g))].join('\n\n')
        }
        case 'status': {
            const g = goals[args.id]; if (!g) return `❌ "${args.id}" not found.`
            return formatGoalCard(g)
        }
        case 'remove': {
            if (!removeGoal(args.id)) return `❌ "${args.id}" not found.`
            broadcastUpdate('goal_removed', { id: args.id, description: '', target: '', deadline: '', progress: 0, status: 'removed' })
            return `🗑️ Goal ${args.id} removed.`
        }
        case 'help': return helpText()
        default: return `❓ Unknown command. Type "Help".`
    }
}

// ─── §15 Incoming Message Router ─────────────────────────
function handleIncomingMessage(raw) {
    let msg; try { msg = JSON.parse(raw) } catch (_) { logWarn('Non-JSON frame'); return }
    logDebug('←', JSON.stringify(msg).slice(0, 300))
    const type = msg.type || ''

    if (type === 'auth_ok') { onAuthenticated(); return }
    if (type === 'auth_error' || type === 'auth_fail') { logError('AUTH FAILED:', msg.message || 'Bad token'); process.exit(1) }
    if (type === 'auth-result' || (type === 'auth' && msg.hasOwnProperty('success'))) { if (msg.success || msg.ok) onAuthenticated(); else { logError('Auth failed (legacy)'); process.exit(1) }; return }
    if (type === 'joined' || type === 'join-result' || type === 'join_ok') { logOk(`Joined: "${msg.channel || '?'}"`); return }

    if (type === 'sidechannel_message' || type === 'message') {
        const content = msg.message || msg.content || msg.data || ''
        const channel = msg.channel || CONFIG.channel
        const sender = msg.sender || msg.from || msg.publicKey || 'unknown'
        const displayContent = (typeof content === 'object') ? JSON.stringify(content) : String(content)
        logInfo(`[${channel}] ${String(sender).slice(0, 12)}…: "${displayContent.slice(0, 120)}"`)

        // Try JSON action first
        let jsonData = (content && typeof content === 'object') ? content : null
        if (!jsonData) {
            try { jsonData = JSON.parse(content) } catch (_) { }
        }
        if (jsonData && typeof jsonData === 'object') {
            logDebug('Handle JSON Action:', JSON.stringify(jsonData))
            // PHASE 3: Inject sender info for peer encouragement
            if (!jsonData.sender && sender !== 'unknown') jsonData.sender = sender
            if (handleJsonAction(jsonData, channel)) return
        }

        // Plaintext fallback
        logDebug('Handle Plaintext:', String(content))
        const parsed = parseGoalInput(String(content))
        if (parsed) { sendToChannel(dispatchCommand(parsed, channel), channel); return }

        if (channel === CONFIG.channel && String(content).trim().length > 0) {
            logDebug('Unknown plaintext command on main channel')
            // sendToChannel('🤖 I didn\'t understand that. Type "Help" for commands.', channel)
        }
        return
    }

    if (type === 'error') { logError('SC-Bridge:', msg.message || msg.error); return }
    if (type === 'stats' || type === 'info' || type === 'pong') { logDebug('Info:', JSON.stringify(msg).slice(0, 200)); return }
    logDebug('Unhandled type:', type)
}

// ─── §16 Connection Management ──────────────────────────
function connect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    logInfo(`Connecting to ${CONFIG.wsUrl} ...`)
    try { ws = new WebSocket(CONFIG.wsUrl) } catch (e) { logError('WS create failed:', e.message); scheduleReconnect(); return }
    ws.on('open', () => { logOk(`Connected to ${CONFIG.wsUrl}`); reconnectAttempts = 0; authenticated = false; authenticate() })
    ws.on('message', (d) => { try { handleIncomingMessage(d.toString()) } catch (e) { logError('Handler error:', e.message) } })
    ws.on('close', (code, reason) => { logWarn(`Disconnected (${code})`); authenticated = false; ws = null; scheduleReconnect() })
    ws.on('error', (e) => { if (e.code === 'ECONNREFUSED') logWarn('Refused — is Intercom running?'); else logError('WS error:', e.message) })
}
function scheduleReconnect() {
    if (reconnectAttempts >= CONFIG.maxReconnectAttempts) { logError('Max reconnects. Exiting.'); process.exit(1) }
    reconnectAttempts++
    const delay = Math.min(CONFIG.reconnectBaseMs * Math.pow(2, reconnectAttempts - 1), CONFIG.reconnectMaxMs)
    logInfo(`Reconnecting in ${(delay / 1000).toFixed(1)}s (${reconnectAttempts}/${CONFIG.maxReconnectAttempts})...`)
    reconnectTimer = setTimeout(connect, delay)
}

// ─── §17 Shutdown ────────────────────────────────────────
function shutdown() {
    logInfo('Shutting down...')
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (ws && ws.readyState === WebSocket.OPEN) {
        sendToChannel(JSON.stringify({ action: 'agent_status', originPeer: CONFIG.peerId, agent: 'goal-tracker-v3', status: 'offline', timestamp: Date.now() }))
        ws.close(1000, 'Shutdown')
    }
    saveGoals(); logOk('Goodbye!'); process.exit(0)
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
process.on('uncaughtException', (e) => { logError('Uncaught:', e.message); saveGoals() })
process.on('unhandledRejection', (r) => { logError('Unhandled rejection:', r) })

// ─── §18 Main ────────────────────────────────────────────
function main() {
    console.log('\n═══════════════════════════════════════════════')
    console.log('  🎯 P2P AI Goal Tracker Agent — Phase 4      ')
    console.log('     Streak Tracking • Auto-Reminders          ')
    console.log('═══════════════════════════════════════════════\n')
    logInfo(`SC-Bridge:  ${CONFIG.wsUrl}`)
    logInfo(`Token:      ${CONFIG.token ? CONFIG.token.slice(0, 4) + '****' : '(NOT SET!)'}`)
    logInfo(`Channels:   ${CONFIG.channel}, ${CONFIG.extraChannels.join(', ')}`)
    logInfo(`Peer ID:    ${CONFIG.peerId}`)
    logInfo(`Persistence: ${CONFIG.goalsFile}\n`)
    if (!CONFIG.token) { logError('SC_BRIDGE_TOKEN required!'); process.exit(1) }
    loadGoals(); connect()
}
main()

/**
 * goal-bridge.js
 * ─────────────────────────────────────────────────────────
 * Bridges the GoalTracker into Intercom's SC-Bridge
 * (WebSocket control surface) and Sidechannel messaging.
 *
 * This is the integration glue — it listens for incoming
 * SC-Bridge JSON commands and sidechannel messages, routes
 * them to the GoalTracker, and broadcasts state changes
 * back out through both planes.
 *
 * SC-Bridge command format (JSON over WebSocket):
 *   { "action": "goal:<verb>", "payload": { ... } }
 *
 * Supported actions:
 *   goal:add        { text: "Save $1000 in 3 months" }
 *   goal:progress   { id: "<goalId>", amount: 100 }
 *   goal:set        { id: "<goalId>", value: 500 }
 *   goal:list       { status?: "active"|"completed"|"failed" }
 *   goal:get        { id: "<goalId>" }
 *   goal:report     { id: "<goalId>" }
 *   goal:summary    {}
 *   goal:remove     { id: "<goalId>" }
 *   goal:sync       {}  (force subnet state push)
 *
 * Sidechannel protocol (plaintext JSON payloads):
 *   Incoming messages prefixed with "GOAL:" are parsed:
 *     GOAL:ADD Save $1000 in 3 months
 *     GOAL:PROGRESS <id> 100
 *     GOAL:LIST
 *     GOAL:SUMMARY
 *
 * Integration:
 *   Call `initGoalBridge(intercomPeer)` from index.js after
 *   the peer is fully initialised.
 * ─────────────────────────────────────────────────────────
 */

'use strict'

const { GoalTracker } = require('./goal-tracker')

// ── Constants ─────────────────────────────────────────────

const GOAL_SC_CHANNEL = 'goal-tracker'  // dedicated sidechannel name
const SYNC_INTERVAL_MS = 60_000         // check deadlines every 60s
const SUBNET_KEY = 'goal-tracker-state' // key in Hyperbee for replicated state

// ── Module state ──────────────────────────────────────────

let tracker = null
let syncTimer = null

// ── SC-Bridge command handler ─────────────────────────────

/**
 * Process an SC-Bridge JSON command related to goals.
 *
 * @param {Object} msg            Parsed JSON from SC-Bridge
 * @param {string} msg.action     e.g. "goal:add"
 * @param {Object} msg.payload    Action-specific data
 * @param {Function} reply        fn(responseObj) → send back to SC-Bridge caller
 * @returns {boolean}             true if the command was handled
 */
function handleBridgeCommand(msg, reply) {
    if (!msg || !msg.action || !msg.action.startsWith('goal:')) return false

    const verb = msg.action.split(':')[1]
    const p = msg.payload || {}

    try {
        switch (verb) {
            // ── Add a new goal ──────────────────────────────────
            case 'add': {
                if (!p.text) return reply({ ok: false, error: 'Missing "text" in payload' })
                const goal = tracker.addGoal(p.text)
                return reply({ ok: true, goal })
            }

            // ── Increment progress ──────────────────────────────
            case 'progress': {
                if (!p.id || p.amount == null) return reply({ ok: false, error: 'Need "id" and "amount"' })
                const goal = tracker.updateProgress(p.id, Number(p.amount))
                return reply({ ok: true, goal })
            }

            // ── Set absolute progress ───────────────────────────
            case 'set': {
                if (!p.id || p.value == null) return reply({ ok: false, error: 'Need "id" and "value"' })
                const goal = tracker.setProgress(p.id, Number(p.value))
                return reply({ ok: true, goal })
            }

            // ── List goals ──────────────────────────────────────
            case 'list': {
                const goals = tracker.listGoals(p.status)
                return reply({ ok: true, goals })
            }

            // ── Get single goal ─────────────────────────────────
            case 'get': {
                if (!p.id) return reply({ ok: false, error: 'Need "id"' })
                const goal = tracker.getGoal(p.id)
                if (!goal) return reply({ ok: false, error: `Goal "${p.id}" not found` })
                return reply({ ok: true, goal })
            }

            // ── Progress report with tip ────────────────────────
            case 'report': {
                if (!p.id) return reply({ ok: false, error: 'Need "id"' })
                const report = tracker.getProgressReport(p.id)
                return reply({ ok: true, report })
            }

            // ── Full summary ────────────────────────────────────
            case 'summary': {
                const summary = tracker.getSummary()
                return reply({ ok: true, summary })
            }

            // ── Remove goal ─────────────────────────────────────
            case 'remove': {
                if (!p.id) return reply({ ok: false, error: 'Need "id"' })
                tracker.removeGoal(p.id)
                return reply({ ok: true, removed: p.id })
            }

            // ── Force sync to subnet ────────────────────────────
            case 'sync': {
                const data = tracker.toJSON()
                return reply({ ok: true, action: 'sync', data })
            }

            default:
                return reply({ ok: false, error: `Unknown goal action: "${verb}"` })
        }
    } catch (err) {
        return reply({ ok: false, error: err.message })
    }
}

// ── Sidechannel message handler ───────────────────────────

/**
 * Parse plaintext sidechannel messages prefixed with "GOAL:".
 * Returns a response string to send back on the channel.
 *
 * @param {string} text       Raw sidechannel message payload
 * @param {Object} peerInfo   { publicKey, channel, ... }
 * @returns {string|null}     Response text, or null if not a goal message
 */
function handleSidechannelMessage(text, peerInfo) {
    if (!text || !text.startsWith('GOAL:')) return null

    const parts = text.slice(5).trim().split(/\s+/)
    const cmd = (parts[0] || '').toUpperCase()

    try {
        switch (cmd) {
            case 'ADD': {
                const raw = parts.slice(1).join(' ')
                if (!raw) return '❌ Usage: GOAL:ADD <description>'
                const goal = tracker.addGoal(raw)
                return `✅ Goal created: [${goal.id}] ${goal.name} — target: ${goal.target} ${goal.unit}`
            }

            case 'PROGRESS': {
                const id = parts[1]
                const amount = Number(parts[2])
                if (!id || isNaN(amount)) return '❌ Usage: GOAL:PROGRESS <id> <amount>'
                const goal = tracker.updateProgress(id, amount)
                const pct = goal.target > 0 ? Math.round((goal.progress / goal.target) * 100) : 0
                return `📊 Progress updated: ${goal.name} — ${pct}% (${goal.progress}/${goal.target} ${goal.unit})`
            }

            case 'LIST': {
                const goals = tracker.listGoals(parts[1])
                if (goals.length === 0) return '📋 No goals found.'
                return goals.map(g => {
                    const pct = g.target > 0 ? Math.round((g.progress / g.target) * 100) : 0
                    return `[${g.status}] ${g.id}: ${g.name} — ${pct}%`
                }).join('\n')
            }

            case 'SUMMARY':
                return tracker.getSummary()

            case 'REPORT': {
                const id = parts[1]
                if (!id) return '❌ Usage: GOAL:REPORT <id>'
                const r = tracker.getProgressReport(id)
                return `📊 ${r.name}: ${r.percent}% | Remaining: ${r.remaining} ${r.unit}\n💡 ${r.tip}`
            }

            case 'REMOVE': {
                const id = parts[1]
                if (!id) return '❌ Usage: GOAL:REMOVE <id>'
                tracker.removeGoal(id)
                return `🗑️ Goal ${id} removed.`
            }

            default:
                return (
                    '📖 Goal commands:\n' +
                    '  GOAL:ADD <description>\n' +
                    '  GOAL:PROGRESS <id> <amount>\n' +
                    '  GOAL:LIST [status]\n' +
                    '  GOAL:REPORT <id>\n' +
                    '  GOAL:SUMMARY\n' +
                    '  GOAL:REMOVE <id>'
                )
        }
    } catch (err) {
        return `❌ Error: ${err.message}`
    }
}

// ── Subnet state sync helpers ─────────────────────────────

/**
 * Push current tracker state into Hyperbee (subnet plane).
 * Called by the onUpdate callback and the periodic sync timer.
 *
 * @param {Object} subnetDb   Hyperbee instance from Intercom peer
 */
async function pushToSubnet(subnetDb) {
    if (!subnetDb) return
    try {
        const data = JSON.stringify(tracker.toJSON())
        await subnetDb.put(SUBNET_KEY, data)
    } catch (err) {
        console.error('[goal-bridge] subnet push failed:', err.message)
    }
}

/**
 * Pull and merge remote tracker state from Hyperbee.
 *
 * @param {Object} subnetDb   Hyperbee instance from Intercom peer
 */
async function pullFromSubnet(subnetDb) {
    if (!subnetDb) return
    try {
        const entry = await subnetDb.get(SUBNET_KEY)
        if (entry && entry.value) {
            const data = JSON.parse(entry.value.toString())
            tracker.fromJSON(data)
        }
    } catch (err) {
        console.error('[goal-bridge] subnet pull failed:', err.message)
    }
}

// ── Initialisation ────────────────────────────────────────

/**
 * Initialise the Goal Tracker bridge.
 *
 * Call this from Intercom's index.js after the peer is set up:
 *
 *   const { initGoalBridge } = require('./features/goal-tracker/goal-bridge')
 *   initGoalBridge(peer)
 *
 * @param {Object} peer  The Intercom peer object. Expected shape:
 *   {
 *     scBridge:     { on(event, handler) },   // SC-Bridge event emitter
 *     sidechannel:  { on(event, handler), send(channel, text) },
 *     subnetDb:     Hyperbee instance (or null),
 *   }
 */
function initGoalBridge(peer) {
    // ── Create tracker with state-change callback ───────────
    tracker = new GoalTracker({
        onUpdate(eventType, goal) {
            console.log(`[goal-tracker] ${eventType}: ${goal.id} (${goal.name})`)

            // Push state to subnet on every mutation
            if (peer.subnetDb) {
                pushToSubnet(peer.subnetDb)
            }

            // Broadcast notable events to the sidechannel
            if (peer.sidechannel && (eventType === 'completed' || eventType === 'failed')) {
                const emoji = eventType === 'completed' ? '🎉' : '⏰'
                const msg = `${emoji} Goal ${eventType}: ${goal.name} (${goal.id})`
                try { peer.sidechannel.send(GOAL_SC_CHANNEL, msg) } catch (_) { }
            }
        }
    })

    // ── Hook into SC-Bridge ─────────────────────────────────
    if (peer.scBridge) {
        peer.scBridge.on('message', (msg, reply) => {
            // Only handle goal:* commands; pass others through
            handleBridgeCommand(msg, reply)
        })
        console.log('[goal-bridge] SC-Bridge handler registered')
    }

    // ── Hook into Sidechannel ───────────────────────────────
    if (peer.sidechannel) {
        peer.sidechannel.on('message', (text, peerInfo) => {
            const response = handleSidechannelMessage(text, peerInfo)
            if (response && peer.sidechannel.send) {
                try {
                    // Reply on the same channel the message came from
                    peer.sidechannel.send(peerInfo.channel || GOAL_SC_CHANNEL, response)
                } catch (_) { }
            }
        })
        console.log('[goal-bridge] Sidechannel handler registered')
    }

    // ── Initial pull from subnet ────────────────────────────
    if (peer.subnetDb) {
        pullFromSubnet(peer.subnetDb).then(() => {
            console.log('[goal-bridge] Initial state loaded from subnet')
        })
    }

    // ── Periodic deadline check + sync ──────────────────────
    syncTimer = setInterval(() => {
        const failed = tracker.checkDeadlines()
        if (failed.length > 0) {
            console.log(`[goal-bridge] ${failed.length} goal(s) marked as failed (deadline passed)`)
        }
        if (peer.subnetDb) pushToSubnet(peer.subnetDb)
    }, SYNC_INTERVAL_MS)

    console.log('[goal-bridge] Goal Tracker Agent initialised ✔')
    return tracker
}

/**
 * Tear down the bridge (for clean shutdown).
 */
function destroyGoalBridge() {
    if (syncTimer) {
        clearInterval(syncTimer)
        syncTimer = null
    }
    tracker = null
    console.log('[goal-bridge] Goal Tracker Agent shut down')
}

// ── Exports ───────────────────────────────────────────────
module.exports = {
    initGoalBridge,
    destroyGoalBridge,
    handleBridgeCommand,
    handleSidechannelMessage,
    // Expose for testing
    get tracker() { return tracker }
}

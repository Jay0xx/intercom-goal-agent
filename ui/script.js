/**
 * script.js — Goal Tracker Dashboard
 * ═══════════════════════════════════════════════════════════
 * Pure vanilla JS. Connects to SC-Bridge WebSocket, handles
 * auth, channel join, goal CRUD, and activity logging.
 * No external dependencies.
 * ═══════════════════════════════════════════════════════════
 */

'use strict'

// ─── DOM refs ────────────────────────────────────────────
const $ = (s) => document.querySelector(s)
const statusBadge = $('#status-badge')
const connectForm = $('#connect-form')
const wsUrlInput = $('#ws-url')
const wsTokenInput = $('#ws-token')
const connectBtn = $('#connect-btn')
const errorBar = $('#error-bar')
const mainContent = $('#main-content')
const goalForm = $('#goal-form')
const goalInput = $('#goal-input')
const progressForm = $('#progress-form')
const progressSelect = $('#progress-goal-select')
const progressValue = $('#progress-value')
const goalsList = $('#goals-list')
const goalsCount = $('#goals-count')
const activityLog = $('#activity-log')
const clearLogBtn = $('#clear-log-btn')

// ─── State ───────────────────────────────────────────────
let ws = null
let authenticated = false
let goals = {}            // { [goalId]: { id, description, target, deadline, progress, status, tip } }
const CHANNEL = 'goals'

// ─── LocalStorage helpers ────────────────────────────────
function loadSaved() {
    const url = localStorage.getItem('gt_ws_url')
    const token = localStorage.getItem('gt_ws_token')
    if (url) wsUrlInput.value = url
    if (token) wsTokenInput.value = token
    // Restore goals from last session
    try {
        const saved = localStorage.getItem('gt_goals')
        if (saved) { goals = JSON.parse(saved); renderGoals() }
    } catch (_) { }
}

function saveConfig() {
    localStorage.setItem('gt_ws_url', wsUrlInput.value)
    localStorage.setItem('gt_ws_token', wsTokenInput.value)
}

function persistGoals() {
    try { localStorage.setItem('gt_goals', JSON.stringify(goals)) } catch (_) { }
}

// ─── UUID generator (simple, no crypto dep) ──────────────
function uuid() {
    return 'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

// ─── Status badge ────────────────────────────────────────
function setStatus(label, level) {
    statusBadge.textContent = label
    statusBadge.className = 'badge badge-' + level  // off, wait, on
}

function showError(msg) {
    errorBar.textContent = msg
    errorBar.hidden = false
    setTimeout(() => { errorBar.hidden = true }, 8000)
}

function hideError() { errorBar.hidden = true }

// ─── Activity log ────────────────────────────────────────
function addLog(from, text) {
    const time = new Date().toLocaleTimeString()
    const entry = document.createElement('div')
    entry.className = 'log-entry'

    const short = from ? String(from).slice(0, 10) : 'system'

    // Try to pretty-print JSON
    let display = text
    try {
        const obj = JSON.parse(text)
        display = JSON.stringify(obj, null, 1)
    } catch (_) { }

    entry.innerHTML =
        `<span class="log-ts">${time}</span> ` +
        `<span class="log-from">${escHtml(short)}</span> ` +
        escHtml(display)

    activityLog.appendChild(entry)
    activityLog.scrollTop = activityLog.scrollHeight

    // Cap at 200 entries
    while (activityLog.children.length > 200) {
        activityLog.removeChild(activityLog.firstChild)
    }
}

function escHtml(s) {
    const d = document.createElement('span')
    d.textContent = s
    return d.innerHTML
}

clearLogBtn.addEventListener('click', () => { activityLog.innerHTML = '' })

// ─── Goal rendering ─────────────────────────────────────
function renderGoals() {
    const list = Object.values(goals)
    goalsCount.textContent = list.length

    if (list.length === 0) {
        goalsList.innerHTML = '<p class="empty-state">No goals yet. Create one above!</p>'
        rebuildSelect()
        return
    }

    goalsList.innerHTML = list.map(g => {
        const pct = Math.min(100, Math.max(0, g.progress || 0))
        const isComplete = pct >= 100 || g.status === 'completed'
        const barClass = isComplete ? 'goal-bar complete' : 'goal-bar'
        const tipHtml = g.tip ? `<div class="goal-tip">💡 ${escHtml(g.tip)}</div>` : ''
        const meta = []
        if (g.target) meta.push(`Target: ${escHtml(g.target)}`)
        if (g.deadline && g.deadline !== 'No specific deadline') meta.push(`Deadline: ${escHtml(g.deadline)}`)
        if (g.category) meta.push(escHtml(g.category))

        return `
      <div class="goal-card" data-id="${escHtml(g.id)}">
        <div class="goal-card-header">
          <strong>${escHtml(g.description || g.id)}</strong>
          <span class="goal-id">${escHtml(g.id)}</span>
        </div>
        ${meta.length ? `<div class="goal-card-meta">${meta.join(' · ')}</div>` : ''}
        <div class="goal-bar-wrap"><div class="${barClass}" style="width:${pct}%"></div></div>
        <div class="goal-pct">${pct}%${isComplete ? ' ✅' : ''}</div>
        <div class="streak">🔥 ${g.streak || 0}-day streak</div>
        ${tipHtml}
      </div>
    `
    }).join('')

    rebuildSelect()
}

function rebuildSelect() {
    const active = Object.values(goals).filter(g => g.status !== 'completed' && (g.progress || 0) < 100)
    progressSelect.innerHTML = '<option value="">— select goal —</option>' +
        active.map(g => `<option value="${escHtml(g.id)}">[${escHtml(g.id)}] ${escHtml((g.description || '').slice(0, 40))}</option>`).join('')
}

// ─── Parse incoming message for goal state ───────────────
function processGoalMessage(rawData) {
    let data = rawData
    if (typeof data === 'string') {
        try { data = JSON.parse(data) } catch (_) { return }
    }
    if (!data || !data.action) return

    switch (data.action) {
        case 'set_goal':
        case 'goal_created': {
            const goal = data.goal || data
            const id = goal.id || goal.goalId || data.goalId || uuid()
            goals[id] = {
                id,
                description: goal.description || data.description || '',
                target: goal.target || data.target || '',
                deadline: goal.deadline || data.deadline || '',
                progress: goal.progress || 0,
                status: goal.status || 'active',
                category: goal.category || data.category || '',
                streak: goal.streak || data.streak || 0,
                lastUpdateDate: goal.lastUpdateDate || data.lastUpdateDate || null,
                tip: data.tip || ''
            }
            persistGoals()
            renderGoals()
            break
        }

        case 'update_progress':
        case 'progress_updated': {
            const goal = data.goal || data
            const id = goal.id || goal.goalId || data.goalId || ''
            if (id && goals[id]) {
                goals[id].progress = goal.progress ?? data.progress ?? goals[id].progress
                goals[id].status = goal.status || goals[id].status
                if (data.tip) goals[id].tip = data.tip
                if (goal.streak !== undefined) goals[id].streak = goal.streak
                if (data.streak !== undefined) goals[id].streak = data.streak
                if (goal.category) goals[id].category = goal.category
                persistGoals()
                renderGoals()
            }
            break
        }

        case 'goals_list': {
            if (Array.isArray(data.goals)) {
                data.goals.forEach(g => {
                    goals[g.id] = { ...goals[g.id], ...g }
                })
                persistGoals()
                renderGoals()
            }
            break
        }

        case 'goal_removed': {
            const id = data.goalId || ''
            if (id && goals[id]) {
                delete goals[id]
                persistGoals()
                renderGoals()
            }
            break
        }
        case 'reminder': {
            addLog(data.originPeer || 'agent', `🔔 REMINDER: ${data.message}`)
            break
        }
    }
}

// ─── WebSocket communication ─────────────────────────────
function wsSend(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showError('Not connected')
        return false
    }
    ws.send(JSON.stringify(obj))
    return true
}

function sendToChannel(message) {
    const msgStr = typeof message === 'string' ? message : JSON.stringify(message)
    return wsSend({ type: 'send', channel: CHANNEL, message: msgStr })
}

// ─── Connect / disconnect ────────────────────────────────
function connect() {
    const url = wsUrlInput.value.trim() || 'ws://127.0.0.1:49222'
    wsUrlInput.value = url
    saveConfig()

    if (ws) {
        try { ws.close() } catch (_) { }
        ws = null
    }

    setStatus('Connecting…', 'wait')
    hideError()
    authenticated = false

    try {
        ws = new WebSocket(url)
    } catch (err) {
        setStatus('Disconnected', 'off')
        showError('Invalid WebSocket URL: ' + err.message)
        return
    }

    ws.onopen = () => {
        addLog('system', 'WebSocket connected')
        // Some SC-Bridge versions send a hello; others expect us to auth immediately.
        // We'll try auth right away; if no token, wait for hello.
        const token = wsTokenInput.value.trim()
        if (token) {
            setStatus('Authenticating…', 'wait')
            wsSend({ type: 'auth', token })
        } else {
            setStatus('Auth Needed', 'wait')
            showError('Enter your SC-Bridge token and reconnect.')
        }
    }

    ws.onmessage = (event) => {
        let msg
        try { msg = JSON.parse(event.data) } catch (_) {
            addLog('bridge', event.data)
            return
        }

        const type = msg.type || ''

        // ── Hello (optional — some bridges send this) ──
        if (type === 'hello') {
            addLog('bridge', 'Hello received' + (msg.requiresAuth ? ' (auth required)' : ''))
            if (msg.requiresAuth && !authenticated) {
                const token = wsTokenInput.value.trim()
                if (token) {
                    setStatus('Authenticating…', 'wait')
                    wsSend({ type: 'auth', token })
                } else {
                    setStatus('Auth Needed', 'wait')
                    showError('Token required. Enter it above and reconnect.')
                }
            } else if (!msg.requiresAuth) {
                onConnected()
            }
            return
        }

        // ── Auth success ──
        if (type === 'auth_ok' || ((type === 'auth-result' || type === 'auth') && (msg.success || msg.ok))) {
            addLog('bridge', 'Authenticated ✔')
            onConnected()
            return
        }

        // ── Auth failure ──
        if (type === 'auth_error' || type === 'auth_fail' || type === 'error') {
            if (!authenticated) {
                setStatus('Auth Failed', 'off')
                showError('Authentication failed: ' + (msg.message || msg.error || 'Invalid token'))
                addLog('bridge', 'Auth failed: ' + (msg.message || msg.error || ''))
                try { ws.close() } catch (_) { }
                return
            }
            // Post-auth error
            addLog('bridge', 'Error: ' + (msg.message || msg.error || JSON.stringify(msg)))
            return
        }

        // ── Join confirmation ──
        if (type === 'joined' || type === 'join-result' || type === 'join_ok') {
            addLog('bridge', 'Joined channel: ' + (msg.channel || CHANNEL))
            return
        }

        // ── Sidechannel message ──
        if (type === 'sidechannel_message' || type === 'message') {
            const content = msg.message || msg.content || msg.data || ''
            const from = msg.from || msg.sender || msg.publicKey || ''
            const channel = msg.channel || ''

            addLog(from || channel, String(content))

            // Try to parse as JSON for goal state updates
            let jsonData = null
            try { jsonData = JSON.parse(content) } catch (_) { }
            if (jsonData && typeof jsonData === 'object') {
                processGoalMessage(jsonData)
            }
            return
        }

        // ── Info / stats ──
        if (type === 'info' || type === 'stats' || type === 'pong') {
            addLog('bridge', JSON.stringify(msg))
            return
        }

        // ── Fallback ──
        addLog('bridge', JSON.stringify(msg))
    }

    ws.onclose = () => {
        setStatus('Disconnected', 'off')
        authenticated = false
        mainContent.hidden = true
        connectBtn.textContent = 'Connect'
        addLog('system', 'Disconnected')
    }

    ws.onerror = () => {
        // Error details come via onclose; avoid duplicate noise
    }
}

function onConnected() {
    authenticated = true
    setStatus('Connected', 'on')
    hideError()
    mainContent.hidden = false
    connectBtn.textContent = 'Disconnect'

    // Auto-join the goals channel
    wsSend({ type: 'join', channel: CHANNEL })
    addLog('system', 'Joining channel: ' + CHANNEL)

    // Request existing goals list from agent
    setTimeout(() => {
        sendToChannel(JSON.stringify({ action: 'list_goals' }))
    }, 500)

    renderGoals()
}

function disconnect() {
    if (ws) {
        try { ws.close(1000, 'User disconnect') } catch (_) { }
        ws = null
    }
    authenticated = false
    setStatus('Disconnected', 'off')
    mainContent.hidden = true
    connectBtn.textContent = 'Connect'
}

// ─── Event listeners ─────────────────────────────────────

// Connect / disconnect toggle
connectForm.addEventListener('submit', (e) => {
    e.preventDefault()
    if (authenticated && ws && ws.readyState === WebSocket.OPEN) {
        disconnect()
    } else {
        connect()
    }
})

// Set new goal
goalForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const text = goalInput.value.trim()
    if (!text) return

    // Send as plaintext "Set goal: ..." (agent parses it)
    const sent = sendToChannel('Set goal: ' + text)
    if (sent) {
        addLog('you', 'Set goal: ' + text)

        // Optimistic local add (agent will confirm/update)
        const id = uuid()
        goals[id] = {
            id,
            description: text,
            target: '',
            deadline: '',
            progress: 0,
            status: 'active',
            tip: ''
        }
        persistGoals()
        renderGoals()
        goalInput.value = ''
    }
})

// Update progress
progressForm.addEventListener('submit', (e) => {
    e.preventDefault()
    const goalId = progressSelect.value
    const pct = parseInt(progressValue.value, 10)
    if (!goalId) { showError('Select a goal first'); return }
    if (isNaN(pct) || pct < 0 || pct > 100) { showError('Enter a valid percentage (0–100)'); return }

    const payload = { action: 'update_progress', goalId, progress: pct }
    const sent = sendToChannel(payload)
    if (sent) {
        addLog('you', JSON.stringify(payload))

        // Optimistic local update
        if (goals[goalId]) {
            goals[goalId].progress = pct
            if (pct >= 100) goals[goalId].status = 'completed'
            persistGoals()
            renderGoals()
        }
        progressValue.value = ''
    }
})

// ─── Init ────────────────────────────────────────────────
loadSaved()
if (!wsUrlInput.value) wsUrlInput.value = 'ws://127.0.0.1:49222'

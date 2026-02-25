/**
 * goal-tips.js
 * ─────────────────────────────────────────────────────────
 * Template-based "AI-like" motivational tip generator.
 *
 * No external API calls — tips come from categorised
 * template banks, selected by:
 *   • Goal category (financial, fitness, learning, general)
 *   • Progress bracket (0-25%, 25-50%, 50-75%, 75-100%)
 *   • Deadline proximity (plenty of time / halfway / urgent)
 *
 * Future: swap this module for a real LLM call (via
 * SC-Bridge → external agent) once available.
 * ─────────────────────────────────────────────────────────
 */

'use strict'

// ── Category detection ────────────────────────────────────

const CATEGORY_KEYWORDS = {
    financial: ['save', 'earn', 'invest', 'budget', 'money', '$', '€', '£', 'income', 'debt', 'pay off', 'savings'],
    fitness: ['run', 'walk', 'gym', 'workout', 'exercise', 'miles', 'km', 'kg', 'lbs', 'push-up', 'pushup', 'sit-up', 'plank', 'swim', 'bike', 'steps', 'weight', 'lose', 'gain'],
    learning: ['read', 'book', 'study', 'learn', 'course', 'chapter', 'lesson', 'practice', 'code', 'write', 'certificate'],
    wellness: ['meditate', 'sleep', 'water', 'hydrate', 'fruits', 'vegetables', 'journal', 'gratitude', 'mindful', 'relax', 'stretch']
}

/**
 * Detect the broad category of a goal.
 * @param {import('./goal-parser').GoalRecord} goal
 * @returns {'financial'|'fitness'|'learning'|'wellness'|'general'}
 */
function detectCategory(goal) {
    const text = `${goal.raw} ${goal.name} ${goal.unit}`.toLowerCase()

    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        if (keywords.some(kw => text.includes(kw))) return cat
    }
    return 'general'
}

// ── Tip template banks ────────────────────────────────────

/**
 * Each bank maps progress brackets to arrays of tip strings.
 * `{name}`, `{target}`, `{unit}`, `{remaining}`, `{percent}`,
 * `{daysLeft}` are interpolated at render time.
 */
const TIPS = {
    financial: {
        start: [
            '💰 Every dollar counts! Start by tracking your daily spending to find hidden savings.',
            '📊 Try the 50/30/20 rule: 50% needs, 30% wants, 20% towards your {unit}{target} goal.',
            '🏦 Set up an automatic transfer — even {unit}10/week adds up faster than you think.',
            '☕ One small habit change (e.g., home coffee) could free up {unit}50+/month.'
        ],
        quarter: [
            '🎯 Great start! You\'re {percent}% there. Keep the momentum going!',
            '📈 At this pace, you\'re building a solid savings habit. Stay consistent.',
            '💡 Consider a no-spend weekend to boost your progress towards {unit}{target}.',
            '🔄 Review your subscriptions — cancelling unused ones could accelerate your goal.'
        ],
        half: [
            '🚀 Halfway to {unit}{target}! You\'re proving you can do this.',
            '📱 Try a savings challenge for the next 30 days to push past the midpoint.',
            '🎉 {percent}% done! Reward yourself micro (not {unit}{remaining} worth, though 😉).',
            '📋 Reassess your budget — any new areas where you can trim?'
        ],
        almost: [
            '🔥 {percent}% — the finish line is in sight! Only {unit}{remaining} to go.',
            '🏁 You\'re so close! Stay disciplined for just a bit longer.',
            '🌟 Almost there! Consider an extra push — any items you can sell or side-gig income?',
            '🏆 {unit}{remaining} remaining. You\'ve got this. Don\'t slow down now!'
        ]
    },

    fitness: {
        start: [
            '🏃 Start small and stay consistent. Even 15 minutes a day builds the habit.',
            '🥇 Your body is adapting — the first {percent}% is the hardest!',
            '🎧 Try a new playlist or podcast to make workouts something you look forward to.',
            '📝 Log every session. Seeing your streak grow is powerful motivation.'
        ],
        quarter: [
            '💪 {percent}% done! Your body is already changing, even if you can\'t see it yet.',
            '🥗 Fuel your progress — nutrition is 80% of the battle.',
            '📊 Track your personal bests. Progress isn\'t always linear, but it\'s real.',
            '👟 Mix up your routine to avoid plateaus. Cross-training works wonders.'
        ],
        half: [
            '🔥 Halfway! {goal.progress} {unit} down, {remaining} to go.',
            '🧘 Recovery is training too — don\'t skip rest days.',
            '📸 Take a progress photo. You\'ll thank yourself later.',
            '🎯 You\'re past the midpoint — the hardest half is behind you.'
        ],
        almost: [
            '🏁 {percent}% — you\'re in the home stretch! Only {remaining} {unit} left.',
            '⚡ Your dedication is paying off. Finish strong!',
            '🏆 So close! Visualise crossing that finish line at {target} {unit}.',
            '🌟 Elite-level consistency. Celebrate this when you hit 100%!'
        ]
    },

    learning: {
        start: [
            '📚 The key to learning is consistency. Even 20 minutes daily compounds fast.',
            '🧠 Break your goal into micro-tasks — one {unit} at a time.',
            '✏️ Take active notes. Summarising in your own words boosts retention by 50%.',
            '🎯 Start with the hardest material when your energy is highest.'
        ],
        quarter: [
            '📖 {percent}% through! You\'re building real knowledge foundations.',
            '🔁 Quick review sessions prevent forgetting. Spaced repetition is your friend.',
            '💡 Try teaching what you\'ve learned — it\'s the best way to solidify understanding.',
            '📝 Keep a "learning log" — noting one key insight per session.'
        ],
        half: [
            '🎓 Halfway to your learning goal! The compound effect is kicking in.',
            '🗣️ Discuss what you\'ve learned with others — social learning accelerates growth.',
            '📊 You\'ve completed {percent}% — adjust your pace if needed, but don\'t stop.',
            '🌱 Growth mindset: you\'re not just reading/studying, you\'re becoming.'
        ],
        almost: [
            '📗 {percent}% — only {remaining} {unit} left! The end is in sight.',
            '🏆 Reflect on how far you\'ve come. You\'re almost a different person.',
            '🚀 Finish strong! Consider what\'s next after this goal.',
            '🌟 Amazing dedication to learning. Don\'t rush the last stretch — savour it.'
        ]
    },

    wellness: {
        start: [
            '🌿 Small daily habits create lasting change. You\'ve started — that\'s the biggest step.',
            '💧 Track your daily check-ins. Consistency beats perfection every time.',
            '🧘 Focus on how you FEEL, not just the numbers. Wellness is holistic.',
            '✨ Pair your new habit with an existing one (habit stacking) for easier adoption.'
        ],
        quarter: [
            '🌱 {percent}% in! Your new habit is taking root. Keep nurturing it.',
            '📱 Set gentle reminders — it takes ~66 days to make a habit truly automatic.',
            '🎵 Create a calming ritual around your wellness practice.',
            '💚 Notice the small improvements in mood and energy. They add up.'
        ],
        half: [
            '☀️ Halfway! Your body and mind are adapting. This is becoming part of you.',
            '🔄 If it\'s feeling routine, mix it up slightly to keep engagement high.',
            '📓 Journal about the changes you\'ve noticed since starting.',
            '🤝 Find an accountability partner — shared goals are more sustainable.'
        ],
        almost: [
            '🏆 {percent}% — you\'ve built a real lifestyle change!',
            '🌟 Only {remaining} {unit} left. Finish with intention, not just obligation.',
            '🎉 Start planning your next wellness goal — momentum is powerful.',
            '💫 You\'re proof that small steps create big transformations.'
        ]
    },

    general: {
        start: [
            '🎯 Every journey starts with a first step. You\'ve set your target — now build the routine.',
            '📅 Break your goal into weekly milestones. Small wins keep motivation high.',
            '🧩 Focus on systems, not just outcomes. The right daily habit hits any target.',
            '⏰ Block dedicated time for this goal. What gets scheduled gets done.'
        ],
        quarter: [
            '📊 {percent}% progress! You\'re building momentum. Keep showing up.',
            '🔄 Review what\'s working and what isn\'t. Adjust your approach, not your goal.',
            '💪 Consistency is more important than intensity. Stay the course.',
            '📝 Track your progress visually — charts and checklists are powerful motivators.'
        ],
        half: [
            '🚀 Halfway there! {remaining} {unit} remaining. The finish line is real.',
            '🎯 Re-read your "why". Reconnecting with purpose fuels the second half.',
            '📈 You\'re past the tipping point. The hardest part is behind you.',
            '🤔 Is your pace sustainable? Adjust if needed — finishing > speed.'
        ],
        almost: [
            '🔥 {percent}% complete! Sprint to the finish — you\'ve earned this.',
            '🏁 Only {remaining} {unit} left. Don\'t coast now!',
            '🏆 Think about how you\'ll celebrate hitting {target} {unit}.',
            '🌟 Incredible discipline. Your future self is grateful.'
        ]
    }
}

// ── Bracket detection ─────────────────────────────────────

/**
 * Determine progression bracket.
 * @param {number} percent 0-100
 * @returns {'start'|'quarter'|'half'|'almost'}
 */
function getBracket(percent) {
    if (percent < 25) return 'start'
    if (percent < 50) return 'quarter'
    if (percent < 75) return 'half'
    return 'almost'
}

// ── Days-left helper ──────────────────────────────────────

/**
 * @param {string} deadlineISO
 * @returns {number|null}
 */
function daysUntil(deadlineISO) {
    if (!deadlineISO) return null
    const diff = new Date(deadlineISO).getTime() - Date.now()
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

// ── Urgency overlay ───────────────────────────────────────

/**
 * If deadline is near, prepend an urgency note.
 * @param {string} deadlineISO
 * @returns {string}
 */
function urgencyPrefix(deadlineISO) {
    const days = daysUntil(deadlineISO)
    if (days === null) return ''
    if (days <= 1) return '⚠️ DEADLINE IS TODAY/TOMORROW! '
    if (days <= 7) return `⏳ Only ${days} days left! `
    if (days <= 14) return `📆 ${days} days remaining — stay focused. `
    return ''
}

// ── Public API ────────────────────────────────────────────

/**
 * Generate a context-aware motivational tip for a goal.
 *
 * @param {import('./goal-parser').GoalRecord} goal
 * @param {number} percent  Current completion percentage (0-100)
 * @returns {string}
 */
function generateTip(goal, percent) {
    const category = detectCategory(goal)
    const bracket = getBracket(percent)
    const pool = (TIPS[category] && TIPS[category][bracket]) || TIPS.general[bracket]

    // Pick a pseudo-random tip from the pool (seeded by goal ID + day)
    const dayIndex = Math.floor(Date.now() / (1000 * 60 * 60 * 24))
    const seed = (goal.id || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0)
    const idx = (seed + dayIndex) % pool.length

    let tip = pool[idx]

    // Interpolate placeholders
    const remaining = Math.max(0, goal.target - goal.progress)
    tip = tip
        .replace(/\{name\}/g, goal.name || 'your goal')
        .replace(/\{target\}/g, String(goal.target))
        .replace(/\{unit\}/g, goal.unit || '')
        .replace(/\{remaining\}/g, String(remaining))
        .replace(/\{percent\}/g, String(percent))
        .replace(/\{daysLeft\}/g, String(daysUntil(goal.deadline) ?? '?'))

    // Prepend urgency warning if applicable
    const prefix = urgencyPrefix(goal.deadline)

    return prefix + tip
}

// ── Exports ───────────────────────────────────────────────
module.exports = { generateTip, detectCategory }

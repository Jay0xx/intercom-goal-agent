/**
 * goal-tracker.js
 * ─────────────────────────────────────────────────────────
 * In-memory + on-disk goal state management.
 *
 * Stores goals in a Map keyed by goal ID.  Provides:
 *   • addGoal(raw)      — parse + persist a new goal
 *   • updateProgress(id, amount)  — log incremental progress
 *   • setProgress(id, amount)     — set absolute progress
 *   • getGoal(id)       — retrieve one goal
 *   • listGoals()       — return all goals
 *   • removeGoal(id)    — delete a goal
 *   • checkDeadlines()  — flag overdue goals as "failed"
 *   • toJSON / fromJSON — serialise for subnet replication
 *
 * Integration note:
 *   The tracker is intended to be instantiated once in the
 *   Intercom main process and wired into SC-Bridge events
 *   via goal-bridge.js.
 * ─────────────────────────────────────────────────────────
 */

'use strict'

const { parseGoal } = require('./goal-parser')
const { generateTip } = require('./goal-tips')

// ── GoalTracker class ─────────────────────────────────────

class GoalTracker {
    /**
     * @param {Object} [opts]
     * @param {Function} [opts.onUpdate]  Called whenever state changes:
     *                                    onUpdate(eventType, goalRecord)
     *                                    eventType ∈ { "added", "progress", "completed", "failed", "removed" }
     */
    constructor(opts = {}) {
        /** @type {Map<string, import('./goal-parser').GoalRecord>} */
        this._goals = new Map()

        /** Optional callback for state-change notifications */
        this._onUpdate = opts.onUpdate || null
    }

    // ── Mutation helpers ──────────────────────────────────────

    /**
     * Parse raw user text and store the resulting goal.
     *
     * @param {string} rawInput  Freeform text, e.g. "Save $1000 in 3 months"
     * @returns {import('./goal-parser').GoalRecord}
     */
    addGoal(rawInput) {
        const goal = parseGoal(rawInput)
        this._goals.set(goal.id, goal)
        this._emit('added', goal)
        return goal
    }

    /**
     * Increment current progress by `amount`.
     * Automatically marks the goal as "completed" once progress ≥ target.
     *
     * @param {string} id      Goal ID
     * @param {number} amount  Positive increment
     * @returns {import('./goal-parser').GoalRecord}
     */
    updateProgress(id, amount) {
        const goal = this._requireGoal(id)
        if (goal.status !== 'active') {
            throw new Error(`Goal "${id}" is already ${goal.status}`)
        }

        goal.progress = Math.min(goal.progress + amount, goal.target)

        if (goal.target > 0 && goal.progress >= goal.target) {
            goal.status = 'completed'
            this._emit('completed', goal)
        } else {
            this._emit('progress', goal)
        }

        return goal
    }

    /**
     * Set progress to an absolute value (clamped to target).
     *
     * @param {string} id
     * @param {number} value
     * @returns {import('./goal-parser').GoalRecord}
     */
    setProgress(id, value) {
        const goal = this._requireGoal(id)
        if (goal.status !== 'active') {
            throw new Error(`Goal "${id}" is already ${goal.status}`)
        }

        goal.progress = Math.max(0, Math.min(value, goal.target))

        if (goal.target > 0 && goal.progress >= goal.target) {
            goal.status = 'completed'
            this._emit('completed', goal)
        } else {
            this._emit('progress', goal)
        }

        return goal
    }

    /**
     * Remove a goal entirely.
     * @param {string} id
     */
    removeGoal(id) {
        const goal = this._requireGoal(id)
        this._goals.delete(id)
        this._emit('removed', goal)
    }

    // ── Queries ───────────────────────────────────────────────

    /**
     * @param {string} id
     * @returns {import('./goal-parser').GoalRecord|undefined}
     */
    getGoal(id) {
        return this._goals.get(id) || undefined
    }

    /**
     * Return all goals as an array, optionally filtered by status.
     *
     * @param {string} [status]  "active" | "completed" | "failed"
     * @returns {import('./goal-parser').GoalRecord[]}
     */
    listGoals(status) {
        const all = Array.from(this._goals.values())
        if (status) return all.filter(g => g.status === status)
        return all
    }

    /**
     * Percentage of target achieved for a single goal.
     *
     * @param {string} id
     * @returns {{ id: string, percent: number, remaining: number, tip: string }}
     */
    getProgressReport(id) {
        const goal = this._requireGoal(id)
        const percent = goal.target > 0
            ? Math.round((goal.progress / goal.target) * 100)
            : 0

        return {
            id: goal.id,
            name: goal.name,
            percent,
            remaining: Math.max(0, goal.target - goal.progress),
            unit: goal.unit,
            status: goal.status,
            tip: generateTip(goal, percent)
        }
    }

    /**
     * Summary of all goals with progress bars (text-friendly).
     * @returns {string}
     */
    getSummary() {
        const goals = this.listGoals()
        if (goals.length === 0) return 'No goals tracked yet.'

        return goals.map(g => {
            const report = this.getProgressReport(g.id)
            const bar = this._progressBar(report.percent)
            const deadlineStr = g.deadline
                ? ` | Due: ${new Date(g.deadline).toLocaleDateString()}`
                : ''
            return (
                `[${g.status.toUpperCase()}] ${g.name}\n` +
                `  ${bar} ${report.percent}% (${g.progress}/${g.target} ${g.unit})${deadlineStr}\n` +
                `  💡 ${report.tip}`
            )
        }).join('\n\n')
    }

    // ── Deadline enforcement ──────────────────────────────────

    /**
     * Check all active goals and mark any past-deadline as "failed".
     * Returns the list of newly-failed goals.
     *
     * @returns {import('./goal-parser').GoalRecord[]}
     */
    checkDeadlines() {
        const now = Date.now()
        const failed = []

        for (const goal of this._goals.values()) {
            if (goal.status !== 'active') continue
            if (!goal.deadline) continue
            if (new Date(goal.deadline).getTime() <= now) {
                goal.status = 'failed'
                failed.push(goal)
                this._emit('failed', goal)
            }
        }

        return failed
    }

    // ── Serialisation (for subnet state replication) ──────────

    /**
     * Serialise the entire tracker state to a JSON-friendly object.
     * Suitable for writing into Hyperbee / Autobase.
     *
     * @returns {{ goals: import('./goal-parser').GoalRecord[], exportedAt: number }}
     */
    toJSON() {
        return {
            goals: Array.from(this._goals.values()),
            exportedAt: Date.now()
        }
    }

    /**
     * Restore tracker state from a previously-serialised blob.
     * Merges incoming goals into existing state (latest createdAt wins).
     *
     * @param {{ goals: import('./goal-parser').GoalRecord[] }} data
     */
    fromJSON(data) {
        if (!data || !Array.isArray(data.goals)) return

        for (const goal of data.goals) {
            const existing = this._goals.get(goal.id)
            // Only overwrite if incoming is newer or missing locally
            if (!existing || goal.createdAt >= existing.createdAt) {
                this._goals.set(goal.id, { ...goal })
            }
        }
    }

    // ── Private helpers ───────────────────────────────────────

    /** @private */
    _requireGoal(id) {
        const goal = this._goals.get(id)
        if (!goal) throw new Error(`Goal not found: "${id}"`)
        return goal
    }

    /** @private */
    _emit(eventType, goal) {
        if (typeof this._onUpdate === 'function') {
            try { this._onUpdate(eventType, { ...goal }) } catch (_) { }
        }
    }

    /**
     * Render a simple text-based progress bar.
     * @private
     * @param {number} percent 0-100
     * @returns {string}
     */
    _progressBar(percent) {
        const filled = Math.round(percent / 5)     // 20 chars total
        const empty = 20 - filled
        return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`
    }
}

// ── Exports ───────────────────────────────────────────────
module.exports = { GoalTracker }

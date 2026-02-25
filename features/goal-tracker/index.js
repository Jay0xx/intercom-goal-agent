/**
 * index.js  (feature barrel export)
 * ─────────────────────────────────────────────────────────
 * Central re-export for the goal-tracker feature.
 *
 * Usage in Intercom's main index.js:
 *
 *   const { initGoalBridge } = require('./features/goal-tracker')
 *   // After peer is fully initialised:
 *   initGoalBridge(peer)
 * ─────────────────────────────────────────────────────────
 */

'use strict'

const { parseGoal, generateId, parseHumanDate } = require('./goal-parser')
const { GoalTracker } = require('./goal-tracker')
const { generateTip, detectCategory } = require('./goal-tips')
const { initGoalBridge, destroyGoalBridge } = require('./goal-bridge')

module.exports = {
    // Core
    parseGoal,
    GoalTracker,
    generateTip,
    detectCategory,

    // Intercom integration
    initGoalBridge,
    destroyGoalBridge,

    // Utilities (exposed for testing / external tooling)
    generateId,
    parseHumanDate
}

/**
 * goal-parser.js
 * ─────────────────────────────────────────────────────────
 * Parses freeform user goal strings into structured data.
 *
 * Designed for the Intercom fork — receives raw text from
 * SC-Bridge messages and returns a goal object consumable
 * by the tracker and the subnet contract.
 *
 * Supported input patterns (case-insensitive):
 *   "Save $1000 in 3 months"
 *   "Run 100 miles by December"
 *   "Read 12 books before 2027-01-01"
 *   "Lose 10kg in 8 weeks"
 *   "Complete 50 push-ups daily for 30 days"
 *
 * Output shape → GoalRecord (see JSDoc below)
 * ─────────────────────────────────────────────────────────
 */

'use strict'

// ── Helpers ───────────────────────────────────────────────

/**
 * Generate a short, collision-resistant ID (no crypto dep).
 * Uses timestamp + random suffix.
 * @returns {string}
 */
function generateId() {
    const ts = Date.now().toString(36)
    const rand = Math.random().toString(36).slice(2, 8)
    return `goal_${ts}_${rand}`
}

/**
 * Map informal duration keywords → milliseconds from now.
 * @param {number} amount
 * @param {string} unit   e.g. "day", "week", "month", "year"
 * @returns {Date}
 */
function relativeDeadline(amount, unit) {
    const now = new Date()
    const u = unit.toLowerCase().replace(/s$/, '') // normalise plural

    switch (u) {
        case 'day':
            now.setDate(now.getDate() + amount)
            break
        case 'week':
            now.setDate(now.getDate() + amount * 7)
            break
        case 'month':
            now.setMonth(now.getMonth() + amount)
            break
        case 'year':
            now.setFullYear(now.getFullYear() + amount)
            break
        default:
            // Fallback: treat unknown unit as days
            now.setDate(now.getDate() + amount)
    }
    return now
}

// ── Regex patterns ────────────────────────────────────────

// Matches monetary values: $1000, $1,000.50, €500, £250
const MONEY_RE = /(?<currency>[$€£])\s?(?<amount>[\d,]+(?:\.\d{1,2})?)/i

// Matches numeric targets with optional unit: 100 miles, 12 books, 10kg
const NUMERIC_TARGET_RE = /(?<amount>\d+(?:\.\d+)?)\s*(?<unit>[a-z%]+)?/i

// Matches relative deadline: "in 3 months", "within 8 weeks"
const RELATIVE_DEADLINE_RE = /(?:in|within|over)\s+(?<amount>\d+)\s+(?<unit>days?|weeks?|months?|years?)/i

// Matches "by <date>": "by December", "by 2027-01-01", "by Dec 2026"
const BY_DATE_RE = /by\s+(?<date>[\w\-,\s]+)/i

// Matches "before <date>"
const BEFORE_DATE_RE = /before\s+(?<date>[\w\-,\s]+)/i

// Matches "for X days/weeks" (duration goals)
const FOR_DURATION_RE = /for\s+(?<amount>\d+)\s+(?<unit>days?|weeks?|months?|years?)/i

// ── Month name resolution ─────────────────────────────────

const MONTH_NAMES = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11
}

/**
 * Attempt to parse a human-friendly date string.
 * Handles: "December", "Dec 2026", "2027-01-01", "January 15 2027"
 * @param {string} raw
 * @returns {Date|null}
 */
function parseHumanDate(raw) {
    if (!raw) return null
    const trimmed = raw.trim()

    // Try ISO / standard Date parse first
    const iso = new Date(trimmed)
    if (!isNaN(iso.getTime())) return iso

    // Try month-name only → last day of that month (current or next year)
    const lower = trimmed.toLowerCase()
    const monthIdx = MONTH_NAMES[lower]
    if (monthIdx !== undefined) {
        const now = new Date()
        let year = now.getFullYear()
        // If the month has already passed this year, use next year
        if (monthIdx <= now.getMonth()) year += 1
        return new Date(year, monthIdx + 1, 0) // last day of month
    }

    // Try "MonthName Year" → "Dec 2026"
    const myMatch = trimmed.match(/^(\w+)\s+(\d{4})$/i)
    if (myMatch) {
        const mi = MONTH_NAMES[myMatch[1].toLowerCase()]
        if (mi !== undefined) {
            return new Date(Number(myMatch[2]), mi + 1, 0)
        }
    }

    // Try "MonthName Day Year" → "January 15 2027"
    const mdyMatch = trimmed.match(/^(\w+)\s+(\d{1,2})\s+(\d{4})$/i)
    if (mdyMatch) {
        const mi = MONTH_NAMES[mdyMatch[1].toLowerCase()]
        if (mi !== undefined) {
            return new Date(Number(mdyMatch[3]), mi, Number(mdyMatch[2]))
        }
    }

    return null
}

// ── Public API ────────────────────────────────────────────

/**
 * @typedef {Object} GoalRecord
 * @property {string}  id          Unique goal identifier
 * @property {string}  raw         Original user input
 * @property {string}  name        Cleaned goal name / action verb phrase
 * @property {number}  target      Numeric target value
 * @property {string}  unit        Unit label (e.g. "$", "miles", "books", "kg", "%")
 * @property {string}  deadline    ISO-8601 deadline string
 * @property {number}  progress    Current progress (starts at 0)
 * @property {number}  createdAt   Unix ms timestamp
 * @property {string}  status      "active" | "completed" | "failed"
 */

/**
 * Parse a freeform goal string into a GoalRecord.
 *
 * @param {string} input  User input, e.g. "Save $1000 in 3 months"
 * @returns {GoalRecord}
 * @throws {Error} If input cannot be meaningfully parsed
 */
function parseGoal(input) {
    if (!input || typeof input !== 'string') {
        throw new Error('Goal input must be a non-empty string')
    }

    const trimmed = input.trim()
    const record = {
        id: generateId(),
        raw: trimmed,
        name: '',
        target: 0,
        unit: '',
        deadline: '',
        progress: 0,
        createdAt: Date.now(),
        status: 'active'
    }

    // ── Extract target ──────────────────────────────────────

    // 1. Try monetary target first
    const moneyMatch = trimmed.match(MONEY_RE)
    if (moneyMatch) {
        record.target = parseFloat(moneyMatch.groups.amount.replace(/,/g, ''))
        record.unit = moneyMatch.groups.currency
    } else {
        // 2. Find the first numeric target with optional unit
        const numMatch = trimmed.match(NUMERIC_TARGET_RE)
        if (numMatch) {
            record.target = parseFloat(numMatch.groups.amount)
            record.unit = (numMatch.groups.unit || '').toLowerCase()
        }
    }

    // ── Extract deadline ────────────────────────────────────

    let deadlineDate = null

    // Relative: "in 3 months", "within 8 weeks"
    const relMatch = trimmed.match(RELATIVE_DEADLINE_RE)
    if (relMatch) {
        deadlineDate = relativeDeadline(
            parseInt(relMatch.groups.amount, 10),
            relMatch.groups.unit
        )
    }

    // "for X days" (duration-style goals)
    if (!deadlineDate) {
        const forMatch = trimmed.match(FOR_DURATION_RE)
        if (forMatch) {
            deadlineDate = relativeDeadline(
                parseInt(forMatch.groups.amount, 10),
                forMatch.groups.unit
            )
        }
    }

    // "by <date>"
    if (!deadlineDate) {
        const byMatch = trimmed.match(BY_DATE_RE)
        if (byMatch) {
            deadlineDate = parseHumanDate(byMatch.groups.date)
        }
    }

    // "before <date>"
    if (!deadlineDate) {
        const beforeMatch = trimmed.match(BEFORE_DATE_RE)
        if (beforeMatch) {
            deadlineDate = parseHumanDate(beforeMatch.groups.date)
        }
    }

    if (deadlineDate) {
        record.deadline = deadlineDate.toISOString()
    }

    // ── Derive goal name ────────────────────────────────────
    // Strip matched tokens to leave the action / description
    let name = trimmed
        .replace(MONEY_RE, '')
        .replace(RELATIVE_DEADLINE_RE, '')
        .replace(FOR_DURATION_RE, '')
        .replace(BY_DATE_RE, '')
        .replace(BEFORE_DATE_RE, '')
        .replace(NUMERIC_TARGET_RE, '')
        .replace(/\s{2,}/g, ' ')  // collapse whitespace
        .trim()

    // Capitalise first letter
    if (name.length > 0) {
        name = name.charAt(0).toUpperCase() + name.slice(1)
    }

    record.name = name || trimmed // fallback to original

    // ── Validate minimally ──────────────────────────────────
    if (record.target === 0 && !record.deadline) {
        throw new Error(
            `Could not extract a target or deadline from: "${trimmed}". ` +
            'Try formats like "Save $1000 in 3 months" or "Run 100 miles by December".'
        )
    }

    return record
}

// ── Exports ───────────────────────────────────────────────
module.exports = { parseGoal, generateId, parseHumanDate }

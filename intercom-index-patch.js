/**
 * intercom-index-patch.js
 * ─────────────────────────────────────────────────────────
 * Example patch showing how to hook the Goal Tracker Agent
 * into Intercom's existing index.js main process.
 *
 * This is NOT meant to replace the entire index.js — it
 * shows the exact lines/blocks to ADD to the existing
 * Intercom entry point.  Search for "// GOAL-TRACKER"
 * comments to locate insertion points.
 *
 * Assumes the default Intercom peer setup:
 *   - peer.scBridge   → SC-Bridge WebSocket emitter
 *   - peer.sidechannel → Sidechannel messaging layer
 *   - peer.subnetDb   → Hyperbee instance (subnet state)
 * ─────────────────────────────────────────────────────────
 */

'use strict'

// ═══════════════════════════════════════════════════════════
// STEP 1: Add this require near the top of index.js,
//         alongside other feature imports.
// ═══════════════════════════════════════════════════════════

// GOAL-TRACKER: import the goal tracker feature
const { initGoalBridge, destroyGoalBridge } = require('./features/goal-tracker')


// ═══════════════════════════════════════════════════════════
// STEP 2: After the peer is fully initialised (after all
//         Hyperswarm joins, SC-Bridge setup, sidechannel
//         setup), add this block.
//
//         Look for a section like:
//           console.log('Peer ready')
//         or the end of the async init function.
// ═══════════════════════════════════════════════════════════

/*
  // GOAL-TRACKER: initialise the P2P Goal Tracker Agent
  // `peer` should expose { scBridge, sidechannel, subnetDb }
  const goalTracker = initGoalBridge({
    scBridge:    peer.scBridge    || null,
    sidechannel: peer.sidechannel || null,
    subnetDb:    peer.subnetDb    || null
  })

  console.log('[index] Goal Tracker Agent loaded ✔')
*/


// ═══════════════════════════════════════════════════════════
// STEP 3: On graceful shutdown (process exit / SIGINT),
//         add cleanup.
//
//         Look for existing shutdown handlers like:
//           process.on('SIGINT', async () => { ... })
// ═══════════════════════════════════════════════════════════

/*
  // GOAL-TRACKER: tear down cleanly
  destroyGoalBridge()
*/


// ═══════════════════════════════════════════════════════════
// STEP 4 (optional): If you want a dedicated sidechannel
//         for goal messages, add it to the CLI args:
//
//           pear run . --sidechannels goal-tracker,...
//
//         The bridge will automatically listen on the
//         configured GOAL_SC_CHANNEL ('goal-tracker').
// ═══════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════
// Quick verification (run this file standalone to test):
// ═══════════════════════════════════════════════════════════

if (require.main === module) {
    console.log('\n── Intercom Goal Tracker Patch — Integration Test ──\n')

    // Simulate a minimal Intercom peer
    const EventEmitter = require('events')

    const mockPeer = {
        scBridge: new EventEmitter(),
        sidechannel: Object.assign(new EventEmitter(), {
            send(channel, text) { console.log(`  [SC → ${channel}]`, text) }
        }),
        subnetDb: null // no Hyperbee in test mode
    }

    // Initialise
    const tracker = initGoalBridge(mockPeer)

    // Simulate SC-Bridge commands
    console.log('\n── SC-Bridge: goal:add ──')
    mockPeer.scBridge.emit('message',
        { action: 'goal:add', payload: { text: 'Save $1000 in 3 months' } },
        (res) => console.log('  Response:', JSON.stringify(res, null, 2))
    )

    console.log('\n── SC-Bridge: goal:add (fitness) ──')
    mockPeer.scBridge.emit('message',
        { action: 'goal:add', payload: { text: 'Run 100 miles by December' } },
        (res) => console.log('  Response:', JSON.stringify(res, null, 2))
    )

    console.log('\n── SC-Bridge: goal:list ──')
    mockPeer.scBridge.emit('message',
        { action: 'goal:list', payload: {} },
        (res) => {
            console.log('  Goals:')
            res.goals.forEach(g => {
                console.log(`    [${g.status}] ${g.id}: ${g.name} — ${g.target} ${g.unit}`)
            })

            // Update progress on first goal
            const id = res.goals[0].id
            console.log(`\n── SC-Bridge: goal:progress (${id}, +250) ──`)
            mockPeer.scBridge.emit('message',
                { action: 'goal:progress', payload: { id, amount: 250 } },
                (r2) => console.log('  Response:', JSON.stringify(r2, null, 2))
            )

            console.log(`\n── SC-Bridge: goal:report (${id}) ──`)
            mockPeer.scBridge.emit('message',
                { action: 'goal:report', payload: { id } },
                (r3) => console.log('  Response:', JSON.stringify(r3, null, 2))
            )
        }
    )

    console.log('\n── SC-Bridge: goal:summary ──')
    mockPeer.scBridge.emit('message',
        { action: 'goal:summary', payload: {} },
        (res) => console.log(res.summary)
    )

    // Simulate sidechannel messages
    console.log('\n── Sidechannel messages ──')
    mockPeer.sidechannel.emit('message', 'GOAL:ADD Read 12 books before 2027-01-01', { channel: 'goal-tracker' })
    mockPeer.sidechannel.emit('message', 'GOAL:LIST', { channel: 'goal-tracker' })
    mockPeer.sidechannel.emit('message', 'GOAL:SUMMARY', { channel: 'goal-tracker' })

    console.log('\n── Cleanup ──')
    destroyGoalBridge()
    console.log('Done ✔\n')
}

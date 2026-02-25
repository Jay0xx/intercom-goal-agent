# Goal Tracker Agent — SKILL.md Addition

> **Paste the section below into your forked repo's SKILL.md, under "Features" or as a new section.**

---

## Goal Tracker Agent (P2P AI Coach)

This fork adds a standalone **AI Goal Tracker Agent** that connects to Intercom's SC-Bridge and provides collaborative goal tracking, motivational coaching, and peer encouragement over sidechannels.

### What it does

- **Parses natural-language goals** — "Set goal: Save $1000 in 3 months" → structured record with target, deadline, category
- **Tracks progress P2P** — Progress updates broadcast to all peers via sidechannel; state persisted locally to `goals.json`
- **Categorizes goals automatically** — Finance, Fitness, Learning, Wellness, or General (keyword matching)
- **Generates smart tips** — 60+ templates, selected by category × progress bracket × deadline proximity
- **Suggests milestones** — Auto-breaks large goals into 20%/50%/80%/100% checkpoints
- **Cheers peers** — Auto-replies to peer progress updates ~40% of the time with encouraging messages (rate-limited to prevent spam)
- **Handles both JSON and plaintext** — Agents send structured `{ "action": "set_goal", ... }`; humans type `"Set goal: ..."`

### How to run

```bash
# Terminal 1: Start Intercom with SC-Bridge
pear run . \
  --peer-store-name agent1 \
  --sc-bridge 1 \
  --sc-bridge-token MY_TOKEN \
  --sidechannels goals,reminders,goal-updates

# Terminal 2: Start the goal tracker agent
npm install ws  # one-time
SC_BRIDGE_TOKEN=MY_TOKEN node goal-tracker-agent.js

# Optional: override WS URL
SC_BRIDGE_WS=ws://127.0.0.1:55000 SC_BRIDGE_TOKEN=MY_TOKEN node goal-tracker-agent.js
```

### Supported commands

| Input | Type | Action |
|---|---|---|
| `Set goal: Run 5km daily by Dec` | plaintext | Creates goal, suggests milestones |
| `Update progress: g001 60%` | plaintext | Logs progress, generates tip |
| `List goals` | plaintext | Shows all goals with progress bars |
| `Goal status: g001` | plaintext | Detail view with milestones |
| `{ "action": "set_goal", ... }` | JSON | Agent-to-agent goal creation |
| `{ "action": "update_progress", "goalId": "g001", "progress": 60 }` | JSON | Agent-to-agent progress |
| `{ "action": "tip_request" }` | JSON | Get a random motivational tip |

### Architecture

```
Agent (Node.js)  ←— ws://127.0.0.1:49222 —→  SC-Bridge (Intercom/Pear)
       │                                              │
       ├─ goals.json (local persistence)               ├─ Sidechannel: "goals"
       ├─ categorizeGoal()                             ├─ Sidechannel: "reminders"
       ├─ generateTip() (60+ templates)                ├─ Sidechannel: "goal-updates"
       ├─ generateMilestoneSuggestions()               │
       └─ generateResponseToPeer() (auto-cheer)       └─ Other peers (P2P)
```

### Testing

1. **Solo test** — Run the agent, then use a WebSocket client (e.g., `wscat`) to send messages directly:
   ```bash
   wscat -c ws://127.0.0.1:49222
   > {"type":"auth","token":"MY_TOKEN"}
   > {"type":"send","channel":"goals","message":"Set goal: Read 10 books by December"}
   ```

2. **Multi-peer test** — Run two Intercom peers + two agents. Send goals from one; watch the other auto-cheer.

3. **Expected logs** on agent startup:
   ```
   ═══════════════════════════════════════════════
     🎯 P2P AI Goal Tracker Agent — Phase 3
        Smart Tips • Milestones • Peer Cheering
   ═══════════════════════════════════════════════
   12:03:01 [GoalAgent] ℹ️  SC-Bridge:  ws://127.0.0.1:49222
   12:03:01 [GoalAgent] ✅ Connected
   12:03:01 [GoalAgent] ✅ Authenticated ✔
   12:03:01 [GoalAgent] ✅ Joined: "goals"
   12:03:01 [GoalAgent] ✅ Online — 3 goal(s)
   ```

### Next phase

**Phase 4: Minimal UI Dashboard** — A vanilla HTML/JS page that connects to the same SC-Bridge WebSocket (or an agent-exposed HTTP endpoint) and renders goal cards with live progress bars, milestone trackers, and real-time peer activity feed. Dark theme, no build tools.

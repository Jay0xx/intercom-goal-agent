---
name: P2P AI Goal Tracker Agent
description: Collaborative goal tracking agent for Intercom/Trac Network — tracks daily streaks for goals and sends periodic motivational reminders to the 'goals' channel to encourage consistent updates.
---

# P2P AI Goal Tracker Agent

## Custom Agent: P2P AI Goal Tracker

This fork implements a collaborative AI Goal Tracker Agent on the Intercom/Trac Network stack.

### Description

Agents act as personal goal coaches: parse user goals (e.g., "Save $1000 by March"), track progress P2P, generate motivational tips/reminders based on progress/deadline/category, track daily streaks with 🔥 counters, and cheer/respond to peer updates in sidechannel "goals". The agent sends periodic motivational reminders to encourage consistent updates.

### Instructions for AI Agents

- Connect via SC-Bridge (`ws://localhost:49222`, auth with token).
- Join channel `"goals"` (and `"reminders"` if used).
- Send/receive structured JSON messages:
  - Set goal: `{ "action": "set_goal", "goalId": "...", "description": "...", "target": "...", "deadline": "..." }`
  - Update: `{ "action": "update_progress", "goalId": "...", "progress": 60 }`
  - Request tip: `{ "action": "tip_request" }`
  - List goals: `{ "action": "list_goals" }`
  - Remove goal: `{ "action": "remove_goal", "goalId": "..." }`
- On update: generate tip (categorized/motivational), broadcast to channel.
- On peer update: 30–50% chance to reply with encouragement.
- Use sidechannel for ephemeral nudges, subnet (if added) for persistent shared goals.
- Be positive, supportive, non-spammy. Rate-limit broadcasts.

### Capabilities

- Real-time P2P goal accountability
- Gamified progress with tips/cheers
- Category-aware coaching (finance, fitness, learning, wellness)
- Daily streak tracking with 🔥 counters
- Periodic auto-reminders for accountability
- Minimal web UI for human input/monitoring
- Local JSON persistence + subnet-ready serialisation

---

## Setup & Running

### Prerequisites

- [Pear runtime](https://docs.pears.com) (mandatory — never use native Node for the Intercom peer)
- Node.js 18+ (for the standalone agent process)
- `ws` package: `npm install ws`

### Step 1: Start the Intercom Peer

```bash
pear run . \
  --peer-store-name agent1 \
  --sc-bridge 1 \
  --sc-bridge-token YOUR_SECRET_TOKEN \
  --sidechannels goals,reminders,goal-updates
```

The SC-Bridge WebSocket will be available at `ws://127.0.0.1:49222` by default.
Check startup logs for the actual port and token confirmation.

### Step 2: Start the Goal Tracker Agent

```bash
export SC_BRIDGE_TOKEN=YOUR_SECRET_TOKEN
npm run agent
```

Optional overrides:

```bash
SC_BRIDGE_WS=ws://127.0.0.1:55000 \
SC_BRIDGE_TOKEN=YOUR_SECRET_TOKEN \
GOALS_CHANNEL=goals \
DEBUG=1 \
node goal-tracker-agent.js
```

### Step 3: Open the Dashboard UI

Open `http://localhost:4040` in your browser.

1. Ensure `ws://127.0.0.1:49222` is in the URL field
2. Enter your SC-Bridge token
3. Click **Connect**
4. Create goals, track progress, see tips in real time

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SC_BRIDGE_WS` | `ws://127.0.0.1:49222` | SC-Bridge WebSocket URL |
| `SC_BRIDGE_TOKEN` | *(required)* | Auth token from `--sc-bridge-token` |
| `GOALS_CHANNEL` | `goals` | Primary sidechannel name |
| `GOALS_FILE` | `./goals.json` | Local persistence file path |
| `DEBUG` | *(unset)* | Set to `1` for verbose logging |

---

## Supported Commands

### Plaintext (human-friendly)

```
Set goal: Run 5km every day by end of month
Update progress: g001 60%
List goals
Goal status: g001
Remove goal: g001
Help
```

### Structured JSON (agent-to-agent)

```json
{ "action": "set_goal", "description": "Save $1000", "target": "$1000", "deadline": "2026-06-01" }
{ "action": "update_progress", "goalId": "g001", "progress": 60 }
{ "action": "tip_request" }
{ "action": "list_goals" }
{ "action": "remove_goal", "goalId": "g001" }
```

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│              Intercom Peer (Pear runtime)                  │
│                                                           │
│  SC-Bridge ←─── ws://127.0.0.1:49222 ───→ Sidechannels   │
│       │                                       │           │
│       │    channels: goals, reminders,         │           │
│       │              goal-updates              │           │
└───────┼───────────────────────────────────────┼───────────┘
        │                                       │
        ▼                                       ▼
┌───────────────────┐                 ┌────────────────────┐
│ goal-tracker-      │                 │ Other Peers (P2P)  │
│ agent.js (Node)    │                 │ running their own  │
│                    │                 │ goal-tracker-agent │
│ • parseGoalInput() │ ◄── JSON/text ──│                    │
│ • categorizeGoal() │                 └────────────────────┘
│ • generateTip()    │
│ • daily streaks    │
│ • auto-reminders   │
│ • peer cheering    │
│ • goals.json       │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│ ui/index.html       │
│ (browser dashboard) │
│ connects to same    │
│ SC-Bridge WS        │
└─────────────────────┘
```

---

## Project Structure

```
intercom-goal-tracker/
├── index.js                    # Intercom core (upstream)
├── goal-tracker-agent.cjs       # Standalone agent (Phase 4)
├── SKILL.md                    # This file
├── features/
│   ├── goal-tracker/           # Our logic
│   ├── sc-bridge/              # Intercom bridge (upstream)
│   ├── sidechannel/            # Intercom sidechannel (upstream)
│   └── timer/                  # Intercom timer (upstream)
└── ui/
    ├── index.html              # Dashboard
    ├── style.css               # Design
    └── script.js               # Logic
```

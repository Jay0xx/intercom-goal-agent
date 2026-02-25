# P2P AI Goal Tracker Agent

> A fork of [Trac-Systems/intercom](https://github.com/Trac-Systems/intercom) with a collaborative AI agent for setting, tracking, and gamifying personal goals via P2P sidechannels. Features motivational tips, peer encouragement, milestone suggestions, and a minimal clean web UI.

### Trac Address (for payouts / rewards)

```
trac132ymaeaglf5wrjx6uwxh33rt9q24hc0c5humptw33lwsklcxdxdq47a2gf
```

*(One unique address per fork — used for 500 TNK vibe competition reward if eligible)*

## Custom Agent: P2P AI Goal Tracker

**Description**  
Agents act as personal goal coaches: parse user goals (e.g., "Save $1000 by March"), track progress P2P, generate motivational tips/reminders based on progress/deadline/category, suggest milestones, and cheer/respond to peer updates in sidechannel "goals".

**Instructions for AI Agents**  
- Connect via SC-Bridge (`ws://localhost:49222`, auth with token).  
- Join channel `"goals"` (and `"reminders"` if used).  
- Send/receive structured JSON messages:  
  - Set goal: `{ "action": "set_goal", "goalId": "...", "description": "...", "target": "...", "deadline": "..." }`  
  - Update: `{ "action": "update_progress", "goalId": "...", "progress": 60 }`  
- On update: generate tip (categorized/motivational), broadcast to channel.  
- On peer update: 30-50% chance to reply with encouragement.  
- Use sidechannel for ephemeral nudges, subnet (if added) for persistent shared goals.  
- Be positive, supportive, non-spammy. Rate-limit broadcasts.

**Capabilities**  
- Real-time P2P goal accountability.  
- Gamified progress with tips/cheers.  
- Minimal web UI for human input/monitoring.

**Run with:**
```bash
pear run . --sc-bridge 1 --sc-bridge-token <token> --sidechannels goals
```

## Quick Start

```bash
# 1. Clone the fork
git clone https://github.com/Jay0xx/intercom-goal-agent
cd intercom-goal-agent

# 2. Install deps
npm install

# 3. Start Intercom peer
# Using pear runtime (must be installed)
pear run . --peer-store-name agent1 --sc-bridge 1 --sc-bridge-token MY_TOKEN --sidechannels goals,reminders,goal-updates

# 4. Start goal tracker agent
export SC_BRIDGE_TOKEN=MY_TOKEN
npm run agent

# 5. Open dashboard
# http://localhost:4040
```

## Features

- **Natural language goal parsing** — "Save $1000 in 3 months" → structured record
- **5 goal categories** — Finance, Fitness, Learning, Wellness, General (auto-detected)
- **60+ motivational tips** — Category × progress bracket × deadline proximity
- **Auto-milestone suggestions** — Breaks large goals into 20%/50%/80%/100% checkpoints
- **Peer cheering** — 40% chance auto-reply with encouragement (rate-limited)
- **Clean dashboard** — Vanilla HTML/JS/CSS, no build tools, connects to same WS
- **Local persistence** — `goals.json` + `localStorage` in browser

## Project Structure

```
├── index.js                  # Intercom core (upstream)
├── goal-tracker-agent.js     # Main agent (Phase 3)
├── SKILL.md                  # Full agent docs + instructions
├── features/goal-tracker/    # Goal tracker logic
├── features/sc-bridge/       # Intercom SC-Bridge (upstream)
├── ui/                       # Browser dashboard
└── contract/                 # Settlement bus contracts (upstream)
```

## Docs

See **[SKILL.md](SKILL.md)** for full setup, environment variables, command reference, architecture, and testing instructions.

## Based On

[Trac-Systems/intercom](https://github.com/Trac-Systems/intercom) — P2P reference implementation for the Trac Network internet of agents.

## License

MIT (same as upstream Intercom)

---

**Trac Address:** `trac132ymaeaglf5wrjx6uwxh33rt9q24hc0c5humptw33lwsklcxdxdq47a2gf`

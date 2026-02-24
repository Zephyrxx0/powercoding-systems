# CLAUDE.md — Zeroclaw Project Context

## Project Overview
Zeroclaw is the **only entry and exit point** for every coding session.
It is a multi-agent orchestration supervisor built on Node.js.

## Architecture

```
Workspace Session Start
  → zeroclaw agent loop (supervisor)
    → user converses (conversation.js)
      → intent classified: new_task | project_init | continue | exit
        ↓
        Planning Phase  [GSD]
          /gsd:new-project | /gsd:discuss-phase N | /gsd:plan-phase N | /gsd:quick
          → creates: .planning/PLAN.md, REQUIREMENTS.md, ROADMAP.md, CONTEXT.md
        ↓
        Task Distribution  (distributor.js)
          → detects available agents: gemini | copilot | codex | opencode
          → installs Superpowers into each agent's config directory
          → assigns tasks round-robin
          → launches each agent in its own tmux pane
        ↓
        Agent TUIs  [Superpowers]
          each agent has \plan, \skil, \exec (Superpowers skills)
          agents read .zeroclaw/<agent>-task.md
          agents write: working files, plan.md, implement.md
          agents commit with: git commit -m "feat(scope): description"
          agents report errors to: .zeroclaw/errors/<agent>-<ts>.md
        ↓
        AgentLightning RL Loop  [microsoft/agent-lightning]
          watches .zeroclaw/errors/ for negative reward signals
          watches .zeroclaw/lightning-spans/ for positive signals
          runs APO (Automatic Prompt Optimization) on error
          writes improved prompts to .zeroclaw/lightning-prompts/
        ↓
        Session End  (user types "exit")
          → lightning summary written
          → .zeroclaw/session.json updated
```

## Tool Integrations

### 1. GSD (get-shit-done)
**Role:** Planning phase driver
**Commands zeroclaw uses:**
- `/gsd:new-project` — spec extraction, requirements, roadmap
- `/gsd:discuss-phase N` — lock in preferences per phase
- `/gsd:plan-phase N` — parallel research + plan + Nyquist validation
- `/gsd:quick` — ad-hoc tasks without full planning overhead
- `/gsd:resume-work` — restore context from previous session
- `/gsd:verify-work N` — post-implementation verification
- `/gsd:complete-milestone` — archive milestone, tag release

### 2. Superpowers (obra/superpowers)
**Role:** Agent skills framework — composable skills for each agent TUI
**Agent commands map to Superpowers:**
- `\plan` → `/superpowers:brainstorm` + `/superpowers:write-plan`
- `\skil` → `find-skills` tool search
- `\exec` → `/superpowers:execute-plan` (parallel subagents)
**Install location per agent:**
- claude:   `~/.claude/superpowers/`   → `~/.claude/skills/superpowers`
- opencode: `~/.config/opencode/superpowers/` → plugin + skills symlink
- codex:    `~/.codex/superpowers/`   → `~/.agents/skills/superpowers`
- gemini:   `~/.gemini/superpowers/`  → `~/.gemini/skills/superpowers`

### 3. AgentLightning (microsoft/agent-lightning)
**Role:** Iterative learning — RL feedback loop for agent improvement
**How it runs:**
- LLM Proxy on port 8765 (agents route LLM calls through it)
- Lightning Store on port 8766 (collects execution spans + rewards)
- APO training triggered on agent errors (negative reward)
- Improved prompts written to `.zeroclaw/lightning-prompts/`
**Fallback:** If not installed, lightweight error-analysis mode runs instead.

## File Layout
```
.zeroclaw/
  session.json          ← session state
  agent-env.sh          ← AgentLightning proxy env vars
  errors/               ← agent error reports (negative reward signals)
  lightning-spans/      ← task completion spans (positive reward signals)
  lightning-prompts/    ← APO-improved agent prompts
  <agent>-task.md       ← task assignment for each agent

.planning/              ← created by GSD
  PLAN.md
  REQUIREMENTS.md
  ROADMAP.md
  CONTEXT.md
  implement.md          ← implementation tracking
  quick/                ← /gsd:quick task dirs
```

## Git Conventions
- **Branch:** `feature/phase-N/<agent>/<slug>` or `feature/<agent>/<slug>`
- **Commits:** Conventional Commits — `<type>(<scope>): <description>`
  - `feat(auth): add login form`
  - `fix(api): handle null response from /users`
  - `docs(readme): update setup instructions`

## Running
```bash
# Install
npm install -g .
zeroclaw-setup      # install GSD + Superpowers + AgentLightning

# Start session
zeroclaw start

# In another terminal — attach to see agents working
tmux attach -t zeroclaw

# Status
zeroclaw status

# Kill session
zeroclaw kill
```

## Agent Helper Shell Functions
Agents source `agents/zeroclaw-agent-helpers.sh` to get:
- `zc_task_start <task>` — emit start span
- `zc_task_done <task>`  — emit success span (positive reward)
- `zc_task_error <task> <error>` — emit error file (negative reward)
- `zc_commit <type> <scope> <desc>` — Conventional Commit
- `zc_branch [phase] <slug>` — create feature branch
- `zc_plan` — invoke Superpowers brainstorm+plan
- `zc_skil <query>` — search Superpowers skills
- `zc_exec` — invoke Superpowers execute-plan
- `zc_verify [phase]` — run GSD verify

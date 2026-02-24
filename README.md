# ⚡ Zeroclaw

**Multi-agent orchestration supervisor — every session starts and ends here.**

Zeroclaw is a thin, opinionated Node.js supervisor that:
1. Talks to you to understand what you want to build
2. Runs a structured planning phase (powered by **GSD**)
3. Breaks the plan into tasks and distributes them across AI coding agents
4. Launches each agent in its own live tmux pane so you can watch them work
5. Enhances every agent with composable skills (powered by **Superpowers**)
6. Runs a continuous learning loop that gets smarter from agent errors (powered by **AgentLightning**)

```
zeroclaw start → you talk → plan → distribute → gemini|copilot|codex|opencode work → done
```

---

## Architecture

```
Workspace Session Start
  → Zeroclaw agent loop
    → user converses
      ├── new project    → GSD /gsd:new-project → plan → distribute
      ├── new task       → GSD /gsd:discuss + /gsd:plan → distribute
      ├── continue       → GSD /gsd:resume-work → distribute
      └── exit           → session end

Task Distribution
  → install Superpowers in each agent's config
  → assign tasks (round-robin)
  → tmux session "zeroclaw" with one window per agent
       ┌──────────┬──────────┬──────────┬──────────┐
       │  gemini  │  copilot │  codex   │opencode  │
       │ working  │ editing  │ planning │  coding  │
       └──────────┴──────────┴──────────┴──────────┘

Agent skills (Superpowers):
  \plan → brainstorm + write-plan
  \skil → skill search
  \exec → execute-plan with subagents

Error feedback (AgentLightning):
  agent error → negative reward → APO → improved prompt → agent retry
  task done   → positive reward → Lightning Store
```

---

## Integrated Tools

| Tool | Role | When it runs |
|---|---|---|
| [GSD](https://github.com/gsd-build/get-shit-done) | Planning phase | Before any agent launches |
| [Superpowers](https://github.com/obra/superpowers) | Agent skills | Inside each agent TUI |
| [AgentLightning](https://github.com/microsoft/agent-lightning) | Iterative RL learning | Continuously alongside agents |

---

## Installation

```bash
# 1. Clone zeroclaw
git clone <repo> zeroclaw
cd zeroclaw
npm install

# 2. Install zeroclaw globally
npm install -g .

# 3. Install all integrations (GSD + Superpowers + AgentLightning)
node scripts/setup.js
```

**Requirements:**
- Node.js ≥ 18
- tmux
- At least one agent: `opencode` | `gemini` | `codex` | `claude` (Claude Code)
- Python + pip (for AgentLightning — optional but recommended)

---

## Usage

```bash
# In any project directory:
zeroclaw start

# Resume a previous session:
zeroclaw start --resume

# Watch agents work (from another terminal):
tmux attach -t zeroclaw

# Check status:
zeroclaw status

# Kill the session:
zeroclaw kill
```

### What you'll see

After you describe what you want, zeroclaw will:

1. **Run GSD** interactively in your terminal to spec out the work
2. **Show task assignments** — which agent gets which task
3. **Open a tmux session** with one window per agent, all running simultaneously

```
zeroclaw session:
  ┌─ supervisor ──────────────────────────────────────┐
  │ Session: abc-123   Workspace: /my-project         │
  │ ROADMAP: Phase 1 - Auth  Phase 2 - API  ...       │
  └───────────────────────────────────────────────────┘

  Window: opencode     Window: codex       Window: gemini
  ┌─────────────┐      ┌─────────────┐     ┌─────────────┐
  │ > opencode  │      │ > codex ... │     │ > gemini .. │
  │ Planning... │      │ Writing ... │     │ Testing ... │
  │             │      │             │     │             │
  └─────────────┘      └─────────────┘     └─────────────┘
```

---

## Git Conventions

Zeroclaw enforces consistent git hygiene across all agents:

| Convention | Format |
|---|---|
| **Branches** | `feature/phase-1/opencode/login-form` |
| **Commits** | `feat(auth): add login form with validation` |
| **Types** | `feat` `fix` `docs` `chore` `refactor` `test` |

---

## Agent Shell Helpers

Each agent sources `agents/zeroclaw-agent-helpers.sh` for:

```bash
zc_task_start "Implement login form"
zc_task_done  "Implement login form"
zc_task_error "Implement login form" "Error message"

zc_commit "feat" "auth" "add login form"
zc_branch 1 "login-form"   # creates feature/phase-1/<agent>/login-form

zc_plan    # → Superpowers brainstorm + write-plan
zc_skil "debugging"   # → search Superpowers skills
zc_exec    # → Superpowers execute-plan

zc_verify 1   # → GSD /gsd:verify-work 1
```

---

## AgentLightning Details

AgentLightning runs as a sidecar alongside agents:

- **LLM Proxy** (`:8765`) — intercepts LLM calls, records spans
- **Lightning Store** (`:8766`) — stores spans with reward signals
- **APO Trainer** — analyses bad spans, generates improved prompts
- **File watcher** — detects `.zeroclaw/errors/` for negative rewards
- **Span watcher** — detects `.zeroclaw/lightning-spans/` for positive rewards

If `agentlightning` is not installed, a lightweight fallback mode runs heuristic error analysis and writes improvement hints to `.zeroclaw/lightning-prompts/`.

Install AgentLightning:
```bash
pip install agentlightning
# or pre-release:
pip install --index-url https://test.pypi.org/simple/ \
            --extra-index-url https://pypi.org/simple/ --pre agentlightning
```

---

## File Structure

```
.zeroclaw/
  session.json           ← session state (auto-managed)
  agent-env.sh           ← AgentLightning proxy env vars
  errors/                ← agent error reports → negative RL rewards
  lightning-spans/       ← task completion spans → positive RL rewards
  lightning-prompts/     ← APO-improved agent guidance
  <agent>-task.md        ← task brief for each agent

.planning/               ← created by GSD
  PLAN.md
  REQUIREMENTS.md
  ROADMAP.md
  CONTEXT.md
  RESEARCH.md
  implement.md
```

---

## License

MIT

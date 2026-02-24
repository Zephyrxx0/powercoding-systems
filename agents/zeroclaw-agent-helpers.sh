#!/usr/bin/env bash
# agents/zeroclaw-agent-helpers.sh
#
# Source this in any agent session to get zeroclaw-aware helpers.
# Agents can call these functions to communicate with the zeroclaw supervisor.
#
# Usage:
#   source ~/.zeroclaw/zeroclaw-agent-helpers.sh
#   zc_task_start "Implement login form"
#   zc_task_done  "Implement login form"
#   zc_task_error "Implement login form" "TypeError: undefined is not a function"
#   zc_commit "feat" "auth" "add login form with validation"

ZEROCLAW_WORKSPACE="${ZEROCLAW_WORKSPACE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
ZEROCLAW_AGENT="${ZEROCLAW_AGENT:-$(basename "$SHELL")}"
ZEROCLAW_DIR="$ZEROCLAW_WORKSPACE/.zeroclaw"
ZEROCLAW_ERRORS_DIR="$ZEROCLAW_DIR/errors"
ZEROCLAW_SPANS_DIR="$ZEROCLAW_DIR/lightning-spans"

# Ensure dirs exist
mkdir -p "$ZEROCLAW_ERRORS_DIR" "$ZEROCLAW_SPANS_DIR"

# Source AgentLightning proxy env if available
[ -f "$ZEROCLAW_DIR/agent-env.sh" ] && source "$ZEROCLAW_DIR/agent-env.sh"

# ── Task lifecycle signals ───────────────────────────────────────────────────

zc_task_start() {
  local task="$1"
  local ts
  ts=$(date -u +"%Y%m%dT%H%M%SZ")
  echo "{ \"agent\": \"$ZEROCLAW_AGENT\", \"task\": \"$task\", \"event\": \"start\", \"ts\": \"$ts\" }" \
    > "$ZEROCLAW_SPANS_DIR/${ZEROCLAW_AGENT}-start-${ts}.json"
  echo "[zeroclaw] ▶ Starting: $task"
}

zc_task_done() {
  local task="$1"
  local ts
  ts=$(date -u +"%Y%m%dT%H%M%SZ")
  echo "{ \"agent\": \"$ZEROCLAW_AGENT\", \"task\": \"$task\", \"success\": true, \"ts\": \"$ts\" }" \
    > "$ZEROCLAW_SPANS_DIR/${ZEROCLAW_AGENT}-done-${ts}.json"
  echo "[zeroclaw] ✓ Done: $task"
}

zc_task_error() {
  local task="$1"
  local error="${2:-unknown error}"
  local ts
  ts=$(date -u +"%Y%m%dT%H%M%SZ")

  # Write error file — AgentLightning watches this dir for negative reward signals
  cat > "$ZEROCLAW_ERRORS_DIR/${ZEROCLAW_AGENT}-${ts}.md" <<EOF
# Agent Error Report
Agent:   $ZEROCLAW_AGENT
Task:    $task
Time:    $ts

## Error
$error

## Context
Branch: $(git branch --show-current 2>/dev/null || echo unknown)
Last commit: $(git log --oneline -1 2>/dev/null || echo none)
EOF

  echo "[zeroclaw] ✗ Error in: $task"
  echo "[zeroclaw]   → AgentLightning will analyze and improve guidance."
}

# ── Git helpers (Conventional Commits + zeroclaw branch conventions) ─────────

zc_commit() {
  local type="${1:-feat}"       # feat | fix | docs | chore | refactor | test
  local scope="${2:-app}"
  local description="$3"
  local extra="${4:-}"

  if [ -z "$description" ]; then
    echo "[zeroclaw] Usage: zc_commit <type> <scope> <description> [body]"
    return 1
  fi

  git add -A
  if [ -n "$extra" ]; then
    git commit -m "${type}(${scope}): ${description}" -m "$extra"
  else
    git commit -m "${type}(${scope}): ${description}"
  fi
  echo "[zeroclaw] Committed: ${type}(${scope}): ${description}"
}

zc_branch() {
  local phase="${1:-}"
  local slug="${2:-task}"
  local safe_slug
  safe_slug=$(echo "$slug" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-\|-$//g' | cut -c1-40)

  local branch
  if [ -n "$phase" ]; then
    branch="feature/phase-${phase}/${ZEROCLAW_AGENT}/${safe_slug}"
  else
    branch="feature/${ZEROCLAW_AGENT}/${safe_slug}"
  fi

  git checkout -b "$branch" 2>/dev/null || git checkout "$branch"
  echo "[zeroclaw] Branch: $branch"
}

# ── Superpowers skill aliases ────────────────────────────────────────────────
# Map \plan \skil \exec to the appropriate runtime command

_zc_runtime() {
  for rt in opencode claude gemini codex; do
    command -v "$rt" &>/dev/null && echo "$rt" && return
  done
  echo "opencode"
}

zc_plan() {
  local rt
  rt=$(_zc_runtime)
  echo "[zeroclaw] \plan → Superpowers brainstorm+plan  (runtime: $rt)"
  case "$rt" in
    opencode) opencode run "/superpowers:brainstorm" ;;
    claude)   claude "/superpowers:brainstorm" ;;
    *)        echo "Use /superpowers:brainstorm in your agent session." ;;
  esac
}

zc_skil() {
  local query="${1:-}"
  echo "[zeroclaw] \skil → Superpowers skill search: $query"
  if [ -n "$SUPERPOWERS_SKILLS_ROOT" ]; then
    grep -rl "$query" "$SUPERPOWERS_SKILLS_ROOT" 2>/dev/null | head -20
  else
    echo "SUPERPOWERS_SKILLS_ROOT not set. Source zeroclaw-agent-helpers.sh after zeroclaw starts."
  fi
}

zc_exec() {
  local rt
  rt=$(_zc_runtime)
  echo "[zeroclaw] \exec → Superpowers execute-plan  (runtime: $rt)"
  case "$rt" in
    opencode) opencode run "/superpowers:execute-plan" ;;
    claude)   claude "/superpowers:execute-plan" ;;
    *)        echo "Use /superpowers:execute-plan in your agent session." ;;
  esac
}

# ── GSD shortcuts ────────────────────────────────────────────────────────────

zc_verify() {
  local phase="${1:-1}"
  local rt
  rt=$(_zc_runtime)
  echo "[zeroclaw] Running GSD verify for phase $phase..."
  case "$rt" in
    opencode) opencode run "/gsd:verify-work $phase" ;;
    claude)   claude "/gsd:verify-work $phase" ;;
    *)        echo "Run /gsd:verify-work $phase in your agent session." ;;
  esac
}

echo "[zeroclaw] Agent helpers loaded. Agent: $ZEROCLAW_AGENT"
echo "[zeroclaw] Workspace: $ZEROCLAW_WORKSPACE"
echo "[zeroclaw] Commands: zc_task_start | zc_task_done | zc_task_error | zc_commit | zc_branch | zc_plan | zc_skil | zc_exec | zc_verify"

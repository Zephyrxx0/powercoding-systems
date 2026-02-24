'use strict';
/**
 * distributor.js — Task Distribution & Agent TUI Launcher.
 *
 * Integrates: obra/superpowers — github.com/obra/superpowers
 *
 * Superpowers provides composable skills for each agent:
 *   \plan  → /superpowers:brainstorm or /superpowers:write-plan
 *   \skil  → skill lookup via find-skills tool
 *   \exec  → /superpowers:execute-plan (subagent-driven development)
 *
 * Where it fits in the architecture:
 *   "Task Distribution" node → "zeroclaw launches agentic TUIs" node.
 *   Superpowers is pre-installed in each agent's config directory before launch.
 *   The TUI panes show agents working live (coding, editing, planning).
 *
 * Each agent runs in its own tmux pane inside a session named "zeroclaw".
 * The user can attach to any pane to watch or intervene.
 *
 * Supported agents: gemini | copilot | codex | opencode
 * Git:  uniform commit messages, structured feature branches
 */

const path    = require('path');
const fs      = require('fs-extra');
const execa   = require('execa');
const chalk   = require('chalk');
const ora     = require('ora');
const { log } = require('./ui');

// Agent registry — each entry is a TUI command zeroclaw knows how to spawn
const AGENTS = {
  gemini:   { bin: 'gemini',   superpowersDir: '~/.gemini',                    args: []                        },
  copilot:  { bin: 'gh',       superpowersDir: '~/.config/gh-copilot',         args: ['copilot', 'suggest']    },
  codex:    { bin: 'codex',    superpowersDir: '~/.codex',                     args: []                        },
  opencode: { bin: 'opencode', superpowersDir: '~/.config/opencode',           args: []                        }
};

class Distributor {
  constructor(workspace, session) {
    this.workspace = workspace;
    this.session   = session;
  }

  /**
   * Take a Plan from Planner and distribute tasks to agents.
   * @param {Plan} plan
   */
  async run(plan) {
    log.section('Task Distribution', `${plan.tasks.length} task(s) found`);

    const available = await this._detectAgents();
    if (!available.length) {
      log.error('No supported agents found (gemini / copilot / codex / opencode). Install at least one.');
      return;
    }

    log.info(`Available agents: ${available.join(', ')}`);

    // Install Superpowers in each available agent's config
    for (const agent of available) {
      await this._ensureSuperpowers(agent);
    }

    // Write plan artifacts that agents will read
    await this._writePlanArtifacts(plan);

    // Distribute tasks across agents (round-robin if > 1 task)
    const assignments = this._assignTasks(plan.tasks, available);
    log.info('Task assignments:');
    for (const [agent, tasks] of Object.entries(assignments)) {
      tasks.forEach(t => log.info(`  [${chalk.cyan(agent)}] ${t}`));
    }

    // Launch tmux session with one pane per agent
    await this._launchTmux(assignments, plan);

    log.done(
      `All agents launched.\n` +
      chalk.gray(`  Attach: `) + chalk.cyan(`tmux attach -t zeroclaw`) + '\n' +
      chalk.gray(`  List:   `) + chalk.cyan(`tmux ls`)
    );
  }

  async resumeFromState() {
    log.section('Continuing Session', 'Restoring from .planning/ state');
    const available = await this._detectAgents();
    if (!available.length) { log.error('No agents found.'); return; }

    for (const agent of available) {
      await this._ensureSuperpowers(agent);
    }

    // Resume via GSD
    const runtime = available.includes('opencode') ? 'opencode' : available[0];
    const paneCmd = `${runtime} run /gsd:resume-work`;
    await this._tmuxNewPane('resume', paneCmd, null);
    log.done('Resume pane launched.');
  }

  /* ── tmux launcher ─────────────────────────────────────────────── */

  async _launchTmux(assignments, plan) {
    const sessionName = 'zeroclaw';

    // Kill stale session if exists
    try { await execa('tmux', ['kill-session', '-t', sessionName]); } catch { /* ok */ }

    // Create new session (detached) — first window is the supervisor pane
    await execa('tmux', ['new-session', '-d', '-s', sessionName, '-n', 'supervisor', '-x', '220', '-y', '50']);

    // First pane shows session status
    const statusScript = this._statusScript(plan);
    await execa('tmux', ['send-keys', '-t', `${sessionName}:supervisor`, statusScript, 'Enter']);

    // One window per agent
    let paneIdx = 0;
    for (const [agentName, tasks] of Object.entries(assignments)) {
      const taskPrompt = this._buildAgentPrompt(agentName, tasks, plan);
      await this._launchAgentPane(sessionName, agentName, taskPrompt, paneIdx);
      paneIdx++;
    }

    // Set layout
    await execa('tmux', ['select-layout', '-t', sessionName, this.session.tmuxLayout || 'tiled']);
  }

  async _launchAgentPane(sessionName, agentName, taskPrompt, paneIdx) {
    const agent = AGENTS[agentName];
    if (!agent) return;

    const windowName = agentName;

    // Write task prompt to a temp file so the agent can read it
    const promptFile = path.join(this.workspace, '.zeroclaw', `${agentName}-task.md`);
    await fs.writeFile(promptFile, taskPrompt);

    let agentCmd;
    switch (agentName) {
      case 'gemini':
        // gemini CLI: pass task inline
        agentCmd = `gemini "${taskPrompt.replace(/"/g, '\\"').split('\n')[0]}"`;
        break;
      case 'copilot':
        agentCmd = `cat ${promptFile} | gh copilot suggest -t shell`;
        break;
      case 'codex':
        agentCmd = `codex "${promptFile}"`;
        break;
      case 'opencode':
      default:
        agentCmd = `opencode`;
        break;
    }

    // Inject the Superpowers bootstrap + GSD context before the agent command
    const bootstrap = this._superpowersBootstrap(agentName);
    const fullCmd   = `${bootstrap} && ${agentCmd}`;

    // Create a new window in the tmux session
    await execa('tmux', ['new-window', '-t', sessionName, '-n', windowName]);
    await execa('tmux', ['send-keys', '-t', `${sessionName}:${windowName}`, `cd ${this.workspace}`, 'Enter']);
    await execa('tmux', ['send-keys', '-t', `${sessionName}:${windowName}`, fullCmd, 'Enter']);

    log.info(`  ${chalk.cyan(`[${agentName}]`)} launched in tmux window "${windowName}"`);
  }

  _statusScript(plan) {
    const header = `echo "━━━ ZEROCLAW SUPERVISOR ━━━" && echo "Session: ${this.session.id}" && echo "Workspace: ${this.workspace}" && echo ""`;
    if (plan.files && plan.files['ROADMAP.md']) {
      return `${header} && cat ${path.join(this.workspace, '.planning', 'ROADMAP.md')} 2>/dev/null || echo "No roadmap yet."`;
    }
    return `${header} && echo "Plan: ${path.join(this.workspace, '.planning', 'PLAN.md')}"`;
  }

  /* ── Superpowers integration ────────────────────────────────────── */

  /**
   * Ensures obra/superpowers is installed in the agent's config directory.
   * Superpowers adds brainstorm, write-plan, execute-plan, debugging, TDD skills.
   * The agent's \plan, \skil, \exec commands map to these superpowers slash commands.
   */
  async _ensureSuperpowers(agentName) {
    const agent     = AGENTS[agentName];
    const configDir = agent.superpowersDir.replace('~', process.env.HOME);
    const skillsDir = path.join(configDir, 'superpowers');

    if (await fs.pathExists(skillsDir)) {
      // Already installed — pull latest
      try {
        await execa('git', ['pull', '--ff-only'], { cwd: skillsDir, stdio: 'pipe' });
      } catch { /* ok if no network */ }
      return;
    }

    const spinner = ora(`Installing Superpowers for ${agentName}...`).start();
    try {
      await fs.ensureDir(configDir);

      // Clone superpowers
      await execa('git', [
        'clone', 'https://github.com/obra/superpowers.git', skillsDir
      ], { stdio: 'pipe' });

      // Set up symlinks per agent
      await this._superpowersLink(agentName, configDir, skillsDir);

      spinner.succeed(`Superpowers installed for ${agentName}`);
    } catch (err) {
      spinner.fail(`Superpowers install failed for ${agentName}: ${err.message}`);
      log.warn('Agents will run without Superpowers skills. Install manually from https://github.com/obra/superpowers');
    }
  }

  async _superpowersLink(agentName, configDir, skillsDir) {
    // Each agent requires a specific symlink structure — matches obra/superpowers docs
    switch (agentName) {
      case 'opencode': {
        const pluginsDir = path.join(configDir, 'plugins');
        const skillsLink = path.join(configDir, 'skills', 'superpowers');
        await fs.ensureDir(pluginsDir);
        await fs.ensureDir(path.join(configDir, 'skills'));
        const pluginSrc = path.join(skillsDir, '.opencode', 'plugins', 'superpowers.js');
        const pluginDst = path.join(pluginsDir, 'superpowers.js');
        if (!await fs.pathExists(pluginDst)) await fs.symlink(pluginSrc, pluginDst);
        if (!await fs.pathExists(skillsLink)) await fs.symlink(path.join(skillsDir, 'skills'), skillsLink);
        break;
      }
      case 'codex': {
        const agentsSkills = path.join(process.env.HOME, '.agents', 'skills', 'superpowers');
        await fs.ensureDir(path.join(process.env.HOME, '.agents', 'skills'));
        if (!await fs.pathExists(agentsSkills)) {
          await fs.symlink(path.join(skillsDir, 'skills'), agentsSkills);
        }
        break;
      }
      case 'gemini': {
        // Gemini uses ~/.gemini/ for config
        const skillsLink = path.join(configDir, 'skills', 'superpowers');
        await fs.ensureDir(path.join(configDir, 'skills'));
        if (!await fs.pathExists(skillsLink)) await fs.symlink(path.join(skillsDir, 'skills'), skillsLink);
        break;
      }
      default:
        break;
    }
  }

  _superpowersBootstrap(agentName) {
    // Export env var so agents can discover skills path
    const skillsPath = path.join(AGENTS[agentName]?.superpowersDir.replace('~', process.env.HOME), 'superpowers', 'skills');
    return `export SUPERPOWERS_SKILLS_ROOT="${skillsPath}"`;
  }

  /* ── Task assignment ────────────────────────────────────────────── */

  _assignTasks(tasks, agents) {
    const assignments = {};
    agents.forEach(a => { assignments[a] = []; });

    tasks.forEach((task, i) => {
      const agent = agents[i % agents.length];
      assignments[agent].push(task);
    });

    return assignments;
  }

  _buildAgentPrompt(agentName, tasks, plan) {
    const taskList = tasks.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const planRef  = path.join(this.workspace, '.planning', 'PLAN.md');
    const implRef  = path.join(this.workspace, '.planning', 'implement.md');

    return `# Zeroclaw Task Assignment — ${agentName}

You are a coding agent in the zeroclaw multi-agent system.

## Your Tasks
${taskList}

## Context Files
- Plan:           ${planRef}
- Implementation: ${implRef}
- Requirements:   ${path.join(this.workspace, '.planning', 'REQUIREMENTS.md')}

## Working Rules
- Follow TDD: write tests before implementation
- Commit after each task: \`git commit -m "feat(<scope>): <task summary>"\`
- Branch: feature/<task-slug>
- Document decisions in implement.md
- Use \\plan to brainstorm, \\skil to look up skills, \\exec to run plans
- If you hit an error, document it in .zeroclaw/errors/<agent>-<timestamp>.md
  (AgentLightning will pick this up for iterative learning)

## Superpowers Commands
- \\plan  → /superpowers:brainstorm or /superpowers:write-plan
- \\skil  → search skills with find-skills tool
- \\exec  → /superpowers:execute-plan (parallel subagents)
- /gsd:verify-work → run verification after tasks complete

Begin with task 1. Good luck.
`;
  }

  /* ── Plan artifacts ─────────────────────────────────────────────── */

  async _writePlanArtifacts(plan) {
    const planDir = path.join(this.workspace, '.planning');
    await fs.ensureDir(planDir);

    // Write implement.md if not already created by GSD
    const implFile = path.join(planDir, 'implement.md');
    if (!await fs.pathExists(implFile)) {
      const tasks = plan.tasks.map(t => `- [ ] ${t}`).join('\n');
      await fs.writeFile(implFile, `# Implementation Tracking\n\n${tasks}\n`);
    }

    // Echo GSD plan files for agents that may not have them
    if (plan.files) {
      for (const [name, content] of Object.entries(plan.files)) {
        const dest = path.join(planDir, name);
        if (!await fs.pathExists(dest)) {
          await fs.writeFile(dest, content);
        }
      }
    }
  }

  /* ── Agent detection ────────────────────────────────────────────── */

  async _detectAgents() {
    const available = [];
    for (const [name, agent] of Object.entries(AGENTS)) {
      try {
        await execa(agent.bin, ['--version'], { stdio: 'pipe', timeout: 3000 });
        available.push(name);
      } catch { /* not installed */ }
    }
    return available;
  }

  async _tmuxNewPane(name, cmd, sessionName) {
    const sn = sessionName || 'zeroclaw';
    try {
      await execa('tmux', ['new-window', '-t', sn, '-n', name]);
      await execa('tmux', ['send-keys', '-t', `${sn}:${name}`, cmd, 'Enter']);
    } catch (err) {
      log.warn(`Could not create tmux pane for ${name}: ${err.message}`);
    }
  }
}

module.exports = Distributor;

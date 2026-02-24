'use strict';
/**
 * planner.js — Planning phase driver.
 *
 * Integrates: get-shit-done (GSD) — github.com/gsd-build/get-shit-done
 *
 * GSD provides:
 *   /gsd:new-project    — spec extraction, requirements, roadmap
 *   /gsd:discuss-phase  — lock in preferences per phase
 *   /gsd:plan-phase     — multi-agent research + plan + Nyquist validation
 *   /gsd:quick          — ad-hoc tasks without full planning overhead
 *   /gsd:resume-work    — restore context from previous session
 *
 * Where it fits in the architecture:
 *   "planning phase" node in the diagram — runs AFTER intent is identified
 *   as either project_init or new_task, BEFORE task distribution.
 *
 * The planner outputs a Plan object that the Distributor turns into
 * agent assignments.
 */

const path    = require('path');
const fs      = require('fs-extra');
const execa   = require('execa');
const chalk   = require('chalk');
const ora     = require('ora');
const { log } = require('./ui');

class Planner {
  constructor(workspace, session) {
    this.workspace = workspace;
    this.session   = session;
    this.planDir   = path.join(workspace, '.planning');
  }

  /**
   * Run the planning phase.
   * @param {object} context  { raw: string, intent: string }
   * @returns {Plan|null}     structured plan ready for distribution
   */
  async run(context) {
    const isNewProject = context.intent === 'project_init';

    log.section('Planning Phase', isNewProject ? 'New project' : 'New task/feature');

    // Ensure GSD is installed; install if missing
    await this._ensureGSD();

    if (isNewProject) {
      return await this._runNewProject(context);
    } else {
      return await this._runNewTask(context);
    }
  }

  /* ── GSD workflows ──────────────────────────────────────────────── */

  async _runNewProject(context) {
    log.info('Launching GSD new-project workflow...');
    log.info(chalk.gray('GSD will extract your spec, define requirements, and build a roadmap.'));
    log.info(chalk.gray('After GSD finishes, zeroclaw will distribute phases to agents.\n'));

    // GSD new-project runs interactively inside the primary pane.
    // We launch it in-process so the user sees the conversation.
    await this._gsdCommand('new-project', ['--auto']);

    // After /gsd:new-project completes, read the generated plan artifacts
    return await this._readGSDPlan();
  }

  async _runNewTask(context) {
    // Determine which phase to work on (default: next unstarted phase)
    const phase = await this._nextPhase();

    if (phase === null) {
      // No existing roadmap — run a quick task
      log.info('No existing roadmap found — running GSD quick mode for this task.');
      await this._gsdCommand('quick', [], context.raw);
      return await this._readQuickPlan();
    }

    log.info(`Running GSD discuss+plan pipeline for phase ${phase}...`);
    await this._gsdCommand('discuss-phase', [String(phase)]);
    await this._gsdCommand('plan-phase',    [String(phase)]);

    return await this._readGSDPlan(phase);
  }

  /* ── GSD command runner ─────────────────────────────────────────── */

  /**
   * Execute a GSD slash command via the configured runtime.
   * GSD supports Claude Code, OpenCode, Gemini CLI, and Codex.
   * Here we use 'opencode' as the primary runtime (configurable).
   */
  async _gsdCommand(cmd, args = [], stdinText = null) {
    const runtime = await this._detectRuntime();
    const gsdCmd  = `/${cmd === 'new-project' ? 'gsd:new-project' : `gsd:${cmd}`}`;
    const spinner = ora(`GSD ${gsdCmd}`).start();

    try {
      let proc;
      if (runtime === 'claude') {
        // Claude Code: commands run inside the claude session
        proc = execa('claude', ['--dangerously-skip-permissions', gsdCmd, ...args], {
          cwd:   this.workspace,
          stdio: 'inherit'
        });
      } else if (runtime === 'opencode') {
        proc = execa('opencode', ['run', gsdCmd, ...args], {
          cwd:   this.workspace,
          stdio: 'inherit',
          ...(stdinText ? { input: stdinText } : {})
        });
      } else if (runtime === 'gemini') {
        proc = execa('gemini', [gsdCmd, ...args], {
          cwd:   this.workspace,
          stdio: 'inherit'
        });
      } else {
        // Codex fallback
        proc = execa('codex', [gsdCmd, ...args], {
          cwd:   this.workspace,
          stdio: 'inherit'
        });
      }
      await proc;
      spinner.succeed(`GSD ${gsdCmd} complete`);
    } catch (err) {
      spinner.fail(`GSD ${gsdCmd} failed`);
      log.warn(`GSD command error: ${err.message}`);
      log.warn('Continuing without GSD output — agents will plan independently.');
    }
  }

  /* ── Plan readers ───────────────────────────────────────────────── */

  async _readGSDPlan(phase = null) {
    const base = phase
      ? path.join(this.planDir, `phase-${String(phase).padStart(2, '0')}`)
      : this.planDir;

    const plan = {
      type:     phase ? 'phase' : 'project',
      phase,
      tasks:    [],
      files:    {}
    };

    // GSD creates PLAN.md, REQUIREMENTS.md, ROADMAP.md, CONTEXT.md
    for (const name of ['PLAN.md', 'REQUIREMENTS.md', 'ROADMAP.md', 'CONTEXT.md', 'RESEARCH.md']) {
      const f = path.join(base, name);
      if (await fs.pathExists(f)) {
        plan.files[name] = await fs.readFile(f, 'utf8');
      }
    }

    // Extract task lines from PLAN.md for agent assignment
    if (plan.files['PLAN.md']) {
      plan.tasks = this._extractTasks(plan.files['PLAN.md']);
    }

    return plan.tasks.length ? plan : null;
  }

  async _readQuickPlan() {
    // GSD quick creates .planning/quick/NNN-slug/PLAN.md
    const quickDir = path.join(this.planDir, 'quick');
    if (!await fs.pathExists(quickDir)) return null;

    const subdirs = await fs.readdir(quickDir);
    const latest  = subdirs.sort().pop();
    if (!latest) return null;

    const planFile = path.join(quickDir, latest, 'PLAN.md');
    if (!await fs.pathExists(planFile)) return null;

    const content = await fs.readFile(planFile, 'utf8');
    return {
      type:  'quick',
      phase: null,
      tasks: this._extractTasks(content),
      files: { 'PLAN.md': content }
    };
  }

  _extractTasks(planMd) {
    // Pull checkbox-style tasks:  - [ ] Do X
    const tasks = [];
    for (const line of planMd.split('\n')) {
      const m = line.match(/[-*]\s*\[[ x]\]\s*(.+)/i);
      if (m) tasks.push(m[1].trim());
    }
    return tasks;
  }

  async _nextPhase() {
    const roadmap = path.join(this.planDir, 'ROADMAP.md');
    if (!await fs.pathExists(roadmap)) return null;

    const content = await fs.readFile(roadmap, 'utf8');
    // Find first unchecked phase: ## Phase N or - [ ] Phase N
    const m = content.match(/Phase\s+(\d+)/i);
    return m ? parseInt(m[1]) : 1;
  }

  /* ── Setup ──────────────────────────────────────────────────────── */

  async _ensureGSD() {
    // Check if GSD is installed by looking for its commands
    const runtime = await this._detectRuntime();
    const configDirs = {
      claude:   process.env.HOME + '/.claude/commands',
      opencode: process.env.HOME + '/.config/opencode/commands',
      gemini:   process.env.HOME + '/.gemini/commands',
      codex:    process.env.HOME + '/.codex/skills/gsd-new-project'
    };

    const dir = configDirs[runtime];
    if (dir && await fs.pathExists(dir)) return;  // Already installed

    log.warn(`GSD not found for runtime "${runtime}". Installing now...`);
    const flags = { claude: '--claude', opencode: '--opencode', gemini: '--gemini', codex: '--codex' };
    try {
      await execa('npx', ['get-shit-done-cc@latest', flags[runtime] || '--opencode', '--global'], {
        cwd: this.workspace, stdio: 'inherit'
      });
      log.done('GSD installed.');
    } catch (err) {
      log.warn(`GSD auto-install failed: ${err.message}. Install manually: npx get-shit-done-cc@latest`);
    }
  }

  async _detectRuntime() {
    // Prefer the runtime the user has available, in priority order
    for (const rt of ['opencode', 'claude', 'gemini', 'codex']) {
      try {
        await execa(rt, ['--version'], { stdio: 'pipe' });
        return rt;
      } catch { /* not found */ }
    }
    return 'claude';  // Default fallback
  }
}

module.exports = Planner;

'use strict';
/**
 * session.js — Workspace session lifecycle manager.
 *
 * Owns the state machine:
 *   idle → conversing → planning → distributing → agents_running → session_end
 */

const path        = require('path');
const fs          = require('fs-extra');
const { v4: uuid }= require('uuid');
const chalk       = require('chalk');
const Conversation= require('./conversation');
const Planner     = require('./planner');
const Distributor = require('./distributor');
const Lightning   = require('./lightning');
const Git         = require('./git');
const { log }     = require('./ui');

class Session {
  constructor(opts = {}) {
    this.workspace    = opts.workspace || process.cwd();
    this.resume       = opts.resume    || false;
    this.lightning    = opts.lightning !== false;  // default ON
    this.tmuxLayout   = opts.tmuxLayout || 'tiled';
    this.id           = uuid();
    this.stateFile    = path.join(this.workspace, '.zeroclaw', 'session.json');
    this.state        = 'idle';
    this.agents       = [];   // active agent descriptors
  }

  /* ─── Public lifecycle ─────────────────────────────────────────────── */

  async start() {
    await this._ensureDirs();
    await this._loadOrInitState();

    log.section('Session', `id=${this.id}  workspace=${this.workspace}`);

    // Initialize git repo / branch hygiene
    const git = new Git(this.workspace);
    await git.ensureRepo();

    // AgentLightning RL server — starts in background if enabled
    let lightning = null;
    if (this.lightning) {
      lightning = new Lightning(this.workspace);
      await lightning.start();
    }

    // Main conversation loop
    const conversation = new Conversation(this.workspace, this);
    await conversation.loop();   // blocks until user exits

    // Session teardown
    await this._saveState({ status: 'ended', endedAt: new Date().toISOString() });
    if (lightning) await lightning.stop();

    log.done('Session ended. Goodbye.');
  }

  static async status() {
    // Print .zeroclaw/session.json from cwd
    const stateFile = path.join(process.cwd(), '.zeroclaw', 'session.json');
    if (!await fs.pathExists(stateFile)) {
      console.log(chalk.yellow('No active session found in this directory.'));
      return;
    }
    const state = await fs.readJson(stateFile);
    console.log(chalk.cyan('\nZeroclaw Session State\n'));
    console.log(JSON.stringify(state, null, 2));
  }

  static async kill() {
    const { execaCommand } = require('execa');
    // Kill the tmux session named zeroclaw if running
    try {
      await execaCommand('tmux kill-session -t zeroclaw');
      console.log(chalk.green('Session killed.'));
    } catch {
      console.log(chalk.yellow('No tmux session named "zeroclaw" found.'));
    }
  }

  /* ─── Intent dispatch (called by Conversation) ─────────────────────── */

  /**
   * Called when user intent is identified.
   * @param {'new_task'|'project_init'|'continue'|'exit'} intent
   * @param {object} context  — extracted context from the conversation
   */
  async dispatch(intent, context = {}) {
    switch (intent) {
      case 'project_init':
      case 'new_task': {
        const planner = new Planner(this.workspace, this);
        const plan    = await planner.run(context);
        if (plan) {
          const dist = new Distributor(this.workspace, this);
          await dist.run(plan);
        }
        break;
      }
      case 'continue': {
        // Restore from .planning/ state via /gsd:resume-work
        const dist = new Distributor(this.workspace, this);
        await dist.resumeFromState();
        break;
      }
      case 'exit': {
        log.info('Wrapping up session...');
        break;
      }
    }
  }

  /* ─── Helpers ───────────────────────────────────────────────────────── */

  async _ensureDirs() {
    await fs.ensureDir(path.join(this.workspace, '.zeroclaw'));
    await fs.ensureDir(path.join(this.workspace, '.planning'));
    await fs.ensureDir(path.join(this.workspace, 'docs', 'session-logs'));
  }

  async _loadOrInitState() {
    if (await fs.pathExists(this.stateFile)) {
      const prev = await fs.readJson(this.stateFile);
      if (prev.status !== 'ended') {
        log.warn(`Resuming unfinished session: ${prev.id}`);
        this.id = prev.id;
      }
    }
    await this._saveState({ status: 'active', startedAt: new Date().toISOString() });
  }

  async _saveState(extra = {}) {
    await fs.writeJson(this.stateFile, {
      id: this.id,
      workspace: this.workspace,
      agents: this.agents,
      ...extra
    }, { spaces: 2 });
  }
}

module.exports = Session;

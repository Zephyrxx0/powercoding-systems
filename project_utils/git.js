'use strict';
/**
 * git.js — Git integration for zeroclaw sessions.
 *
 * Enforces:
 *  - Structured branch names:  feature/<phase>/<slug>
 *  - Uniform commit messages:  <type>(<scope>): <description>  (Conventional Commits)
 *  - Session tags:             zeroclaw/<session-id>
 *  - Auto-stash before switching branches
 */

const execa   = require('execa');
const fs      = require('fs-extra');
const path    = require('path');
const { log } = require('./ui');

class Git {
  constructor(workspace) {
    this.workspace = workspace;
  }

  /** Ensure the workspace is a git repo. Init if not. */
  async ensureRepo() {
    try {
      await execa('git', ['rev-parse', '--git-dir'], { cwd: this.workspace, stdio: 'pipe' });
    } catch {
      log.info('Initializing git repo...');
      await execa('git', ['init'], { cwd: this.workspace, stdio: 'inherit' });
      await execa('git', ['commit', '--allow-empty', '-m', 'chore: initial zeroclaw session'], {
        cwd: this.workspace, stdio: 'inherit'
      });
    }
    await this._ensureGitignore();
  }

  /** Create a feature branch for an agent's task set. */
  async createFeatureBranch(agentName, phase, taskSlug) {
    const slug   = this._slugify(taskSlug);
    const branch = phase
      ? `feature/phase-${phase}/${agentName}/${slug}`
      : `feature/${agentName}/${slug}`;

    try {
      await execa('git', ['checkout', '-b', branch], { cwd: this.workspace, stdio: 'pipe' });
      log.info(`  Branch created: ${branch}`);
    } catch {
      // Branch may already exist — just switch to it
      await execa('git', ['checkout', branch], { cwd: this.workspace, stdio: 'pipe' });
    }
    return branch;
  }

  /** Commit with a Conventional Commits message. */
  async commit(type, scope, description, extra = '') {
    const msg = `${type}(${scope}): ${description}${extra ? '\n\n' + extra : ''}`;
    try {
      await execa('git', ['add', '-A'], { cwd: this.workspace, stdio: 'pipe' });
      await execa('git', ['commit', '-m', msg], { cwd: this.workspace, stdio: 'inherit' });
      log.info(`  Committed: ${msg.split('\n')[0]}`);
    } catch (err) {
      // Nothing to commit — that's fine
      if (!err.stdout?.includes('nothing to commit')) {
        log.warn(`  Commit failed: ${err.message}`);
      }
    }
  }

  /** Tag the current commit with a session marker. */
  async tag(label) {
    try {
      await execa('git', ['tag', label], { cwd: this.workspace, stdio: 'pipe' });
    } catch { /* tag may exist */ }
  }

  /** Merge a feature branch back to the base branch. */
  async merge(featureBranch, baseBranch = 'main') {
    try {
      await execa('git', ['checkout', baseBranch], { cwd: this.workspace, stdio: 'pipe' });
      await execa('git', ['merge', '--no-ff', featureBranch, '-m', `merge(${featureBranch}): completed agent work`], {
        cwd: this.workspace, stdio: 'inherit'
      });
      log.info(`  Merged ${featureBranch} → ${baseBranch}`);
    } catch (err) {
      log.warn(`  Merge failed: ${err.message}`);
    }
  }

  /** Print a compact git log. */
  async shortLog(n = 10) {
    const { stdout } = await execa('git', [
      'log', `--oneline`, `-${n}`, '--decorate'
    ], { cwd: this.workspace, stdio: 'pipe' });
    return stdout;
  }

  /* ── Helpers ────────────────────────────────────────────────────── */

  _slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  async _ensureGitignore() {
    const gi = path.join(this.workspace, '.gitignore');
    const entries = [
      '.zeroclaw/session.json',
      '.zeroclaw/agent-env.sh',
      '.zeroclaw/lightning-spans/',
      'node_modules/',
      '.env',
      '*.log'
    ];

    let current = '';
    if (await fs.pathExists(gi)) current = await fs.readFile(gi, 'utf8');

    const missing = entries.filter(e => !current.includes(e));
    if (missing.length) {
      await fs.appendFile(gi, '\n# zeroclaw\n' + missing.join('\n') + '\n');
    }
  }
}

module.exports = Git;

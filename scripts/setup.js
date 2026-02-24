#!/usr/bin/env node
'use strict';
/**
 * scripts/setup.js
 *
 * One-shot installer that sets up all three external tool integrations:
 *
 *   1. GSD (get-shit-done)        — planning phase driver
 *      github.com/gsd-build/get-shit-done
 *      Installs to whichever runtime is detected (claude/opencode/gemini/codex)
 *
 *   2. Superpowers (obra)          — agent skills framework
 *      github.com/obra/superpowers
 *      Installs for each detected agent runtime
 *
 *   3. AgentLightning (microsoft)  — RL iterative learning
 *      github.com/microsoft/agent-lightning
 *      Python package: pip install agentlightning
 *
 * Run: node scripts/setup.js
 *  or: zeroclaw-setup (if installed globally)
 */

const execa = require('execa');
const chalk = require('chalk');
const ora   = require('ora');
const fs    = require('fs-extra');
const path  = require('path');

const HOME = process.env.HOME;

// ── Runtime detection ────────────────────────────────────────────────────────

async function detectRuntimes() {
  const runtimes = {};
  for (const rt of ['claude', 'opencode', 'gemini', 'codex']) {
    try {
      await execa(rt, ['--version'], { stdio: 'pipe', timeout: 3000 });
      runtimes[rt] = true;
    } catch { runtimes[rt] = false; }
  }
  return runtimes;
}

function printRuntimes(rts) {
  console.log(chalk.cyan('\nDetected runtimes:'));
  for (const [rt, found] of Object.entries(rts)) {
    const icon = found ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${icon}  ${rt}`);
  }
  console.log();
}

// ── GSD ──────────────────────────────────────────────────────────────────────

async function installGSD(runtimes) {
  console.log(chalk.cyan.bold('\n1. get-shit-done (GSD)'));
  console.log(chalk.gray('   Context engineering & spec-driven development for the planning phase.'));

  const flagMap = {
    claude:   '--claude',
    opencode: '--opencode',
    gemini:   '--gemini',
    codex:    '--codex'
  };

  for (const [rt, found] of Object.entries(runtimes)) {
    if (!found) continue;
    const spinner = ora(`  Installing GSD for ${rt}...`).start();
    try {
      await execa('npx', ['get-shit-done-cc@latest', flagMap[rt], '--global'], { stdio: 'pipe' });
      spinner.succeed(`  GSD installed for ${rt}`);
    } catch (err) {
      spinner.fail(`  GSD install failed for ${rt}: ${err.message}`);
    }
  }
}

// ── Superpowers ───────────────────────────────────────────────────────────────

const SUPERPOWERS_TARGETS = {
  claude:   { dir: `${HOME}/.claude/superpowers`,               skillLink: `${HOME}/.claude/skills/superpowers`,            pluginLink: null },
  opencode: { dir: `${HOME}/.config/opencode/superpowers`,      skillLink: `${HOME}/.config/opencode/skills/superpowers`,   pluginLink: `${HOME}/.config/opencode/plugins/superpowers.js` },
  gemini:   { dir: `${HOME}/.gemini/superpowers`,               skillLink: `${HOME}/.gemini/skills/superpowers`,             pluginLink: null },
  codex:    { dir: `${HOME}/.codex/superpowers`,                skillLink: `${HOME}/.agents/skills/superpowers`,             pluginLink: null }
};

async function installSuperpowers(runtimes) {
  console.log(chalk.cyan.bold('\n2. Superpowers (obra/superpowers)'));
  console.log(chalk.gray('   Composable skills framework: \\plan, \\skil, \\exec for each agent.'));

  for (const [rt, found] of Object.entries(runtimes)) {
    if (!found) continue;
    const target  = SUPERPOWERS_TARGETS[rt];
    if (!target) continue;

    const spinner = ora(`  Installing Superpowers for ${rt}...`).start();
    try {
      // Clone or update
      if (await fs.pathExists(target.dir)) {
        await execa('git', ['pull', '--ff-only'], { cwd: target.dir, stdio: 'pipe' });
        spinner.text = `  Updating Superpowers for ${rt}...`;
      } else {
        await fs.ensureDir(path.dirname(target.dir));
        await execa('git', ['clone', 'https://github.com/obra/superpowers.git', target.dir], { stdio: 'pipe' });
      }

      // Skills symlink
      if (target.skillLink) {
        await fs.ensureDir(path.dirname(target.skillLink));
        if (!await fs.pathExists(target.skillLink)) {
          await fs.symlink(path.join(target.dir, 'skills'), target.skillLink);
        }
      }

      // Plugin symlink (opencode)
      if (target.pluginLink) {
        await fs.ensureDir(path.dirname(target.pluginLink));
        const src = path.join(target.dir, '.opencode', 'plugins', 'superpowers.js');
        if (!await fs.pathExists(target.pluginLink) && await fs.pathExists(src)) {
          await fs.symlink(src, target.pluginLink);
        }
      }

      spinner.succeed(`  Superpowers installed for ${rt}`);
    } catch (err) {
      spinner.fail(`  Superpowers failed for ${rt}: ${err.message}`);
    }
  }

  // Write a .claude/commands alias for `\plan`, `\skil`, `\exec` if Claude Code is present
  if (runtimes.claude) {
    await writeClaudeAliases();
  }
}

async function writeClaudeAliases() {
  const cmdDir = `${HOME}/.claude/commands`;
  await fs.ensureDir(cmdDir);

  const aliases = {
    'plan.md':  '# Superpowers: Brainstorm & Plan\n\n/superpowers:brainstorm then /superpowers:write-plan',
    'skil.md':  '# Superpowers: Find Skills\n\nUse the find-skills tool to search for relevant skills.',
    'exec.md':  '# Superpowers: Execute Plan\n\n/superpowers:execute-plan'
  };

  for (const [file, content] of Object.entries(aliases)) {
    const dest = path.join(cmdDir, file);
    if (!await fs.pathExists(dest)) {
      await fs.writeFile(dest, content);
    }
  }
  console.log(chalk.gray('  \\plan, \\skil, \\exec aliases written to ~/.claude/commands/'));
}

// ── AgentLightning ────────────────────────────────────────────────────────────

async function installAgentLightning() {
  console.log(chalk.cyan.bold('\n3. AgentLightning (microsoft/agent-lightning)'));
  console.log(chalk.gray('   Reinforcement learning feedback loop — trains agents from experience.'));

  // Check if Python / pip is available
  let hasPip = false;
  for (const pip of ['pip3', 'pip']) {
    try { await execa(pip, ['--version'], { stdio: 'pipe' }); hasPip = true; break; } catch {}
  }

  if (!hasPip) {
    console.log(chalk.yellow('  ⚠  pip not found. Install Python then run: pip install agentlightning'));
    return;
  }

  // Check if already installed
  try {
    await execa('agentlightning', ['--version'], { stdio: 'pipe' });
    console.log(chalk.green('  ✓  AgentLightning already installed'));
    return;
  } catch {}

  const spinner = ora('  Installing agentlightning...').start();
  try {
    await execa('pip3', [
      'install', '--upgrade',
      '--index-url',      'https://test.pypi.org/simple/',
      '--extra-index-url','https://pypi.org/simple/',
      '--pre',            'agentlightning'
    ], { stdio: 'pipe' });
    spinner.succeed('  AgentLightning installed');
  } catch (err) {
    // Fallback: stable release channel
    try {
      await execa('pip3', ['install', 'agentlightning'], { stdio: 'pipe' });
      spinner.succeed('  AgentLightning installed (stable)');
    } catch (err2) {
      spinner.fail(`  AgentLightning install failed: ${err2.message}`);
      console.log(chalk.gray('  Manual install: pip install agentlightning'));
      console.log(chalk.gray('  Or pre-release: pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ --pre agentlightning'));
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(chalk.cyan.bold('\n⚡  Zeroclaw Setup\n'));
  console.log('Installing integrations for GSD · Superpowers · AgentLightning\n');

  const runtimes = await detectRuntimes();
  printRuntimes(runtimes);

  const anyFound = Object.values(runtimes).some(Boolean);
  if (!anyFound) {
    console.log(chalk.yellow(
      'No coding agent runtimes found.\n' +
      'Install at least one:\n' +
      '  opencode: npm i -g opencode-ai\n' +
      '  gemini:   npm i -g @google/generative-ai-cli\n' +
      '  codex:    npm i -g @openai/codex\n' +
      '  claude:   npm i -g @anthropic-ai/claude-code\n'
    ));
  }

  await installGSD(runtimes);
  await installSuperpowers(runtimes);
  await installAgentLightning();

  console.log(chalk.green.bold('\n✓  Setup complete!\n'));
  console.log(chalk.white('Start a session:'));
  console.log(chalk.cyan('  zeroclaw start\n'));
  console.log(chalk.white('Or inside your project:'));
  console.log(chalk.cyan('  cd my-project && zeroclaw start\n'));
}

main().catch(err => {
  console.error(chalk.red('\nSetup failed:'), err.message);
  process.exit(1);
});

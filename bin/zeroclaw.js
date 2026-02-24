#!/usr/bin/env node
'use strict';

/**
 * zeroclaw — the only entry and exit point for every coding session.
 *
 * Architecture flow:
 *  Workspace Session Start
 *    → Zeroclaw agent loop (supervisor)
 *      → user converses
 *        → new feature / project init / continue session / task distribution
 *          → planning phase   (GSD: /gsd:new-project, /gsd:discuss-phase, /gsd:plan-phase)
 *          → task distribution
 *          → launch agentic TUIs  (gemini | copilot | codex | opencode)
 *              each agent enhanced with Superpowers skills (\plan, \skil, \exec)
 *          → agents create plan.md, implement.md, working files
 *          → uniform commits / structured branches
 *          → errors/gaps → AgentLightning iterative learning loop
 *      → session end
 */

const { program } = require('commander');
const Session     = require('../project_utils/session');
const { banner }  = require('../project_utils/ui');

program
  .name('zeroclaw')
  .description('Multi-agent orchestration supervisor')
  .version('1.0.0');

program
  .command('start [workspace]')
  .description('Start a new workspace session (default: current directory)')
  .option('-r, --resume', 'Resume last session via /gsd:resume-work')
  .option('--no-lightning', 'Disable AgentLightning RL feedback loop')
  .option('--tmux-layout <layout>', 'tmux pane layout: tiled|even-horizontal|even-vertical|main-horizontal', 'tiled')
  .action(async (workspace, opts) => {
    await banner();
    const session = new Session({ workspace: workspace || process.cwd(), ...opts });
    await session.start();
  });

program
  .command('status')
  .description('Show status of running agents in the current session')
  .action(async () => {
    const Session = require('../project_utils/session');
    await Session.status();
  });

program
  .command('kill')
  .description('Gracefully end the current session, archive state')
  .action(async () => {
    const Session = require('../project_utils/session');
    await Session.kill();
  });

program.parse(process.argv);

// Default to `start` if no subcommand given
if (!process.argv.slice(2).length) {
  (async () => {
    await banner();
    const session = new Session({ workspace: process.cwd() });
    await session.start();
  })();
}

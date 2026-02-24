'use strict';
/**
 * conversation.js — Interactive user↔zeroclaw dialogue.
 *
 * Responsibilities:
 *  - Present the user with a clear prompt
 *  - Classify the user's message into an intent
 *  - Pass intent + context to session.dispatch()
 *
 * Intent classes:
 *  project_init  → brand new project (/gsd:new-project)
 *  new_task      → new feature / plan on existing project
 *  continue      → resume previous session work
 *  exit          → end session
 *  unknown       → ask clarifying question
 */

const readline = require('readline');
const chalk    = require('chalk');
const { log }  = require('./ui');

/** Simple keyword classifier — replace with LLM call if desired */
function classifyIntent(text) {
  const t = text.toLowerCase();
  if (/\b(exit|quit|bye|done|end session)\b/.test(t)) return 'exit';
  if (/\b(new project|init|initialise|initialize|scaffold|start fresh|create project)\b/.test(t)) return 'project_init';
  if (/\b(continue|resume|pick up|restore|where (was|were) (i|we))\b/.test(t)) return 'continue';
  if (/\b(new (feature|task|plan)|add|implement|build|fix|refactor|update|create)\b/.test(t)) return 'new_task';
  return 'unknown';
}

class Conversation {
  constructor(workspace, session) {
    this.workspace = workspace;
    this.session   = session;
    this.rl = readline.createInterface({
      input:  process.stdin,
      output: process.stdout
    });
  }

  async loop() {
    log.info(
      chalk.cyan('zeroclaw supervisor ready.\n') +
      chalk.gray('Commands: "new project" | "new task: ..." | "continue" | "exit"\n') +
      chalk.gray('Type anything to start — I\'ll figure out the rest.\n')
    );

    while (true) {
      const input = await this._prompt(chalk.green('you › '));
      if (!input.trim()) continue;

      const intent  = classifyIntent(input);
      const context = { raw: input, intent };

      if (intent === 'exit') {
        await this.session.dispatch('exit', context);
        break;
      }

      if (intent === 'unknown') {
        log.info(
          chalk.yellow('Not sure what you want. Be more specific:\n') +
          '  "new project — <description>"\n' +
          '  "new task: <what to build>"\n' +
          '  "continue"\n' +
          '  "exit"'
        );
        continue;
      }

      await this.session.dispatch(intent, context);

      // After dispatching a task the user can continue, add more tasks, or exit
    }

    this.rl.close();
  }

  _prompt(question) {
    return new Promise(resolve => this.rl.question(question, resolve));
  }
}

module.exports = Conversation;

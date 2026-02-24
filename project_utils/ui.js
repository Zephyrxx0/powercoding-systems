'use strict';
/**
 * ui.js — Terminal UI helpers for zeroclaw.
 */

const chalk  = require('chalk');
const boxen  = require('boxen');
const figlet = require('figlet');

async function banner() {
  try {
    const text = figlet.textSync('ZEROCLAW', { font: 'ANSI Shadow', horizontalLayout: 'default' });
    console.log(chalk.cyan(text));
  } catch {
    console.log(chalk.cyan.bold('\n  ⚡  ZEROCLAW  ⚡\n'));
  }

  console.log(
    boxen(
      chalk.white('Multi-agent orchestration supervisor\n') +
      chalk.gray('Powered by GSD · Superpowers · AgentLightning'),
      {
        padding:     1,
        margin:      { top: 0, bottom: 1 },
        borderStyle: 'round',
        borderColor: 'cyan'
      }
    )
  );
}

const log = {
  info:    (...a) => console.log(chalk.blue('  ℹ'), ...a),
  done:    (...a) => console.log(chalk.green('  ✓'), ...a),
  warn:    (...a) => console.log(chalk.yellow('  ⚠'), ...a),
  error:   (...a) => console.log(chalk.red('  ✖'), ...a),
  section: (title, sub = '') => {
    const bar = chalk.cyan('─'.repeat(52));
    console.log(`\n${bar}`);
    console.log(chalk.cyan.bold(`  ${title}`) + (sub ? chalk.gray(`  ${sub}`) : ''));
    console.log(`${bar}\n`);
  }
};

module.exports = { banner, log };

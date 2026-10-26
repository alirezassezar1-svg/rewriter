import chalk from 'chalk';

const levels = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel = levels.info;

export function setLogLevel(level) {
  if (levels[level] !== undefined) currentLevel = levels[level];
}

export const logger = {
  debug(...args) {
    if (currentLevel <= levels.debug) console.log(chalk.gray('[debug]'), ...args);
  },
  info(...args) {
    if (currentLevel <= levels.info) console.log(chalk.cyan('[info]'), ...args);
  },
  warn(...args) {
    if (currentLevel <= levels.warn) console.warn(chalk.yellow('[warn]'), ...args);
  },
  error(...args) {
    if (currentLevel <= levels.error) console.error(chalk.red('[error]'), ...args);
  },
  success(...args) {
    console.log(chalk.green('[ok]'), ...args);
  },
  step(msg) {
    console.log(chalk.blue('→'), msg);
  },
};

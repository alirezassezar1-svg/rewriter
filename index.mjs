#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { migrate } from './cli/migrate.mjs';
import { inspect } from './cli/inspect.mjs';
import { batch } from './cli/batch.mjs';
import { printHelp } from './cli/help.mjs';
import { logger, setLogLevel } from './core/logger.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    offline: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    'keep-source': { type: 'boolean' },
    output: { type: 'string', short: 'o' },
    timeout: { type: 'string' },
    concurrency: { type: 'string' },
    json: { type: 'boolean' },
    force: { type: 'boolean' },
    manifest: { type: 'string' },
    verbose: { type: 'boolean' },
  },
});

if (values.version) {
  console.log('rewriter 1.0.0');
  process.exit(0);
}

if (values.help || positionals.length === 0) {
  printHelp();
  process.exit(0);
}

if (values.verbose) setLogLevel('debug');

const command = positionals[0];
const rest = positionals.slice(1);

const opts = {
  offline: values.offline || false,
  dryRun: values['dry-run'] || false,
  keepSource: values['keep-source'] || false,
  output: values.output || './output',
  timeout: values.timeout ? parseInt(values.timeout, 10) : 900000,
  concurrency: values.concurrency ? parseInt(values.concurrency, 10) : 2,
  json: values.json || false,
  force: values.force || false,
  manifest: values.manifest || null,
};

try {
  if (command === 'migrate') {
    const input = rest[0] || opts.manifest;
    if (!input) {
      logger.error('Missing input. Usage: rewriter migrate <path|url|glob>');
      process.exit(1);
    }
    await migrate(input, opts);
  } else if (command === 'inspect') {
    const input = rest[0];
    if (!input) {
      logger.error('Missing input. Usage: rewriter inspect <path|url>');
      process.exit(1);
    }
    await inspect(input, opts);
  } else if (command === 'batch') {
    const manifest = rest[0] || opts.manifest;
    if (!manifest) {
      logger.error('Missing manifest. Usage: rewriter batch <manifest.txt>');
      process.exit(1);
    }
    await batch(manifest, opts);
  } else {
    logger.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }
} catch (e) {
  logger.error(e.message || e);
  if (opts.json) {
    console.log(JSON.stringify({ error: e.message, code: e.code || 'UNKNOWN' }));
  }
  process.exit(1);
}

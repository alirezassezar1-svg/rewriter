import { readFile } from 'node:fs/promises';
import pLimit from 'p-limit';
import { migrate } from './migrate.mjs';
import { logger } from '../core/logger.mjs';

export async function batch(manifestPath, opts) {
  const raw = await readFile(manifestPath, 'utf8');
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  logger.info(`Batch mode: ${lines.length} inputs (concurrency ${opts.concurrency})`);

  const limit = pLimit(opts.concurrency || 2);
  const results = await Promise.all(
    lines.map((line) =>
      limit(async () => {
        try {
          await migrate(line, opts);
          return { input: line, ok: true };
        } catch (e) {
          logger.error(`Failed ${line}: ${e.message}`);
          return { input: line, ok: false, error: e.message };
        }
      })
    )
  );

  const ok = results.filter((r) => r.ok).length;
  logger.info(`Batch finished: ${ok}/${results.length} succeeded`);
  if (opts.json) console.log(JSON.stringify(results, null, 2));
}

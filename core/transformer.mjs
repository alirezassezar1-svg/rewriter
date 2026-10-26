import { getStrategy } from '../strategies/index.mjs';
import { logger } from './logger.mjs';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Layer 4 — apply planned strategies in order.
 * Records every change into transforms.log (JSONL).
 */
export async function transform(projectDir, planResult, logPath) {
  const applied = [];
  const allChanges = [];

  for (const step of planResult.strategies) {
    const fn = getStrategy(step.strategy);
    if (!fn) {
      logger.warn(`Strategy not implemented: ${step.strategy} — skipping`);
      applied.push({
        id: step.id,
        strategy: step.strategy,
        fallbackUsed: false,
        filesChanged: 0,
        skipped: true,
        reason: 'not implemented',
      });
      continue;
    }

    logger.step(`Applying strategy: ${step.strategy}`);
    try {
      const result = await fn(projectDir);
      const filesChanged = result.changes?.length || 0;
      applied.push({
        id: step.id,
        strategy: step.strategy,
        fallbackUsed: Boolean(result.fallbackUsed),
        filesChanged,
      });
      allChanges.push(...(result.changes || []));

      // write JSONL entries
      if (logPath && result.changes) {
        for (const ch of result.changes) {
          const line = JSON.stringify({
            file: ch.file,
            strategy: step.strategy,
            action: ch.action,
            note: ch.note || null,
            before: ch.before || null,
            after: ch.after || null,
          }) + '\n';
          await appendFile(logPath, line, 'utf8');
        }
      }
    } catch (e) {
      logger.error(`Strategy ${step.strategy} failed: ${e.message}`);
      applied.push({
        id: step.id,
        strategy: step.strategy,
        fallbackUsed: false,
        filesChanged: 0,
        error: e.message,
      });
    }
  }

  return { applied, allChanges };
}

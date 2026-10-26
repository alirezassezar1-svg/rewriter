import { globby } from 'globby';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.mjs';

/**
 * Find API route files and leave a clear stub comment.
 * We do NOT delete them (honesty); we mark them as non-functional in static mode.
 */
export async function stubApi(projectDir) {
  const patterns = [
    'app/api/**/*.{ts,js}',
    'pages/api/**/*.{ts,js}',
    'src/api/**/*.{ts,js}',
    'api/**/*.{ts,js}',
  ];
  const files = await globby(patterns, { cwd: projectDir, deep: 6 });
  const changes = [];

  for (const rel of files) {
    const abs = path.join(projectDir, rel);
    let content = await readFile(abs, 'utf8');
    if (content.includes('rewriter: STATIC STUB')) continue;

    const stub = `/**
 * rewriter: STATIC STUB
 * This API route cannot run on static hosting (GitHub Pages).
 * It has been left in place so you can see what needs a real backend.
 * Replace calls to this endpoint with client-side logic or a third-party service.
 */\n`;
    content = stub + content;
    await writeFile(abs, content, 'utf8');
    changes.push({ file: rel, action: 'annotate-stub' });
  }

  if (changes.length) logger.info(`Annotated ${changes.length} API route(s) as static stubs`);
  return { ok: true, changes, strategy: 'stub-api', fallbackUsed: false };
}

import { globby } from 'globby';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.mjs';

/**
 * Extremely conservative DB handling.
 * We do NOT rewrite query logic. We annotate files that import pg / prisma / drizzle
 * and tell the user they must switch to PGlite or a remote API themselves.
 */
export async function pgToMock(projectDir) {
  const files = await globby(['**/*.{ts,tsx,js,jsx}'], {
    cwd: projectDir,
    deep: 5,
    ignore: ['node_modules/**', 'dist/**', '.next/**'],
  });

  const dbMarkers = [
    "from 'pg'",
    'from "pg"',
    "from 'mysql2'",
    "from '@prisma/client'",
    "from 'drizzle-orm'",
    "from 'kysely'",
    "from 'better-sqlite3'",
  ];

  const changes = [];
  for (const rel of files.slice(0, 80)) {
    const abs = path.join(projectDir, rel);
    let content = await readFile(abs, 'utf8').catch(() => '');
    if (!content) continue;
    if (!dbMarkers.some((m) => content.includes(m))) continue;
    if (content.includes('rewriter: DB REQUIRES MANUAL PORT')) continue;

    const banner = `/**
 * rewriter: DB REQUIRES MANUAL PORT
 * Server-side database drivers cannot run in the browser.
 * Recommended path:
 *  1. Switch to @electric-sql/pglite (in-browser Postgres)
 *  2. Or expose your data via a public read-only API
 *  3. Or keep a real backend and only ship the frontend as static
 */\n`;
    content = banner + content;
    await writeFile(abs, content, 'utf8');
    changes.push({ file: rel, action: 'annotate-db' });
  }

  if (changes.length) logger.info(`Annotated ${changes.length} database file(s)`);
  return { ok: true, changes, strategy: 'pg-to-mock', fallbackUsed: true };
}

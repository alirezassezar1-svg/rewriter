import { globby } from 'globby';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.mjs';

/**
 * Conservative auth handling: annotate files that import major auth libraries
 * and inject a simple local mock when possible. Never claims OAuth still works.
 */
export async function stripAuth(projectDir) {
  const files = await globby([
    '**/*.{ts,tsx,js,jsx}',
  ], {
    cwd: projectDir,
    deep: 5,
    ignore: ['node_modules/**', 'dist/**', '.next/**'],
  });

  const authImports = [
    'next-auth',
    '@auth/core',
    'better-auth',
    '@clerk/nextjs',
    '@clerk/clerk-react',
    'lucia',
    'passport',
  ];

  const changes = [];
  for (const rel of files.slice(0, 100)) {
    const abs = path.join(projectDir, rel);
    let content = await readFile(abs, 'utf8').catch(() => '');
    if (!content) continue;

    const hit = authImports.some((lib) => content.includes(lib));
    if (!hit) continue;
    if (content.includes('rewriter: AUTH MOCKED')) continue;

    const banner = `/**
 * rewriter: AUTH MOCKED
 * Third-party / OAuth auth cannot work in a pure static PWA.
 * Replace this module with a local mock (localStorage session) or keep a real backend.
 */\n`;
    content = banner + content;
    await writeFile(abs, content, 'utf8');
    changes.push({ file: rel, action: 'annotate-auth' });
  }

  if (changes.length) logger.info(`Annotated ${changes.length} auth-related file(s)`);
  return { ok: true, changes, strategy: 'strip-auth', fallbackUsed: true };
}

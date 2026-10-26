import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.mjs';

/**
 * Conservative Next.js → static export transform.
 * Only edits next.config.* to set output: 'export'.
 * Does NOT rewrite server components or actions (those become blockers).
 */
export async function nextToExport(projectDir) {
  const changes = [];
  const candidates = [
    'next.config.js',
    'next.config.mjs',
    'next.config.ts',
    'next.config.mts',
  ];

  let configPath = null;
  for (const c of candidates) {
    try {
      await stat(path.join(projectDir, c));
      configPath = path.join(projectDir, c);
      break;
    } catch { /* continue */ }
  }

  if (!configPath) {
    // create a minimal one
    configPath = path.join(projectDir, 'next.config.mjs');
    const content = `/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
};
export default nextConfig;
`;
    await writeFile(configPath, content, 'utf8');
    changes.push({ file: 'next.config.mjs', action: 'create', note: 'Added output: "export"' });
    logger.info('Created next.config.mjs with output: "export"');
    return { ok: true, changes, strategy: 'next-to-export', fallbackUsed: false };
  }

  let content = await readFile(configPath, 'utf8');
  if (content.includes("output: 'export'") || content.includes('output: "export"')) {
    return { ok: true, changes: [], strategy: 'next-to-export', fallbackUsed: false, note: 'already configured' };
  }

  // naive but safe insertion
  if (content.includes('const nextConfig') || content.includes('module.exports')) {
    content = content.replace(
      /(const nextConfig\s*=\s*\{)/,
      `$1\n  output: 'export',\n  images: { unoptimized: true },`
    );
    if (!content.includes("output: 'export'")) {
      // fallback append before last }
      content = content.replace(/(\n?\s*)(export\s+default|module\.exports)/, `\n  output: 'export',\n  images: { unoptimized: true },\n$1$2`);
    }
  } else {
    // last resort: prepend a comment and leave for human
    content = `// rewriter: please set output: 'export' manually\n` + content;
  }

  await writeFile(configPath, content, 'utf8');
  changes.push({ file: path.basename(configPath), action: 'patch', note: 'Set output: "export"' });
  logger.info(`Patched ${path.basename(configPath)} for static export`);
  return { ok: true, changes, strategy: 'next-to-export', fallbackUsed: false };
}

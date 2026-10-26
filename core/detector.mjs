import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { globby } from 'globby';
import { logger } from './logger.mjs';

async function safeJson(p) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/**
 * Layer 2 — full capability detection.
 */
export async function detect(projectDir, classification) {
  const pkg = await safeJson(path.join(projectDir, 'package.json')) || {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  // package manager
  let packageManager = 'npm';
  if (await exists(path.join(projectDir, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
  else if (await exists(path.join(projectDir, 'yarn.lock'))) packageManager = 'yarn';
  else if (await exists(path.join(projectDir, 'bun.lockb'))) packageManager = 'bun';

  // lockfile
  const hasLockfile = await exists(path.join(projectDir, 'package-lock.json')) ||
                      await exists(path.join(projectDir, 'pnpm-lock.yaml')) ||
                      await exists(path.join(projectDir, 'yarn.lock')) ||
                      await exists(path.join(projectDir, 'bun.lockb'));

  // build tool
  let buildTool = 'unknown';
  if (deps.vite || deps['@vitejs/plugin-react']) buildTool = 'vite';
  else if (deps.next) buildTool = 'next';
  else if (deps['react-scripts']) buildTool = 'webpack'; // CRA
  else if (deps.parcel) buildTool = 'parcel';
  else if (deps.webpack) buildTool = 'webpack';
  else if (deps.esbuild) buildTool = 'esbuild';
  else if (deps.rollup) buildTool = 'rollup';

  // TypeScript
  const hasTypeScript = Boolean(deps.typescript || deps['@types/react'] ||
    await exists(path.join(projectDir, 'tsconfig.json')));

  // tests
  const hasTests = Boolean(deps.vitest || deps.jest || deps.mocha || deps['@playwright/test'] ||
    (await globby(['**/*.{test,spec}.{ts,tsx,js,jsx}'], { cwd: projectDir, deep: 4 })).length > 0);

  // env vars (naive scan)
  const envFiles = await globby(['.env*', '**/.env*'], { cwd: projectDir, deep: 2, ignore: ['node_modules/**'] });
  const requiredEnvs = new Set();
  const usedEnvs = new Set();
  for (const f of envFiles.slice(0, 5)) {
    try {
      const content = await readFile(path.join(projectDir, f), 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=/);
        if (m) requiredEnvs.add(m[1]);
      }
    } catch { /* skip */ }
  }
  // also scan source for process.env / import.meta.env
  const srcFiles = await globby(['src/**/*.{ts,tsx,js,jsx}', 'app/**/*.{ts,tsx,js,jsx}', 'pages/**/*.{ts,tsx,js,jsx}'], {
    cwd: projectDir, deep: 5, ignore: ['node_modules/**'],
  });
  for (const f of srcFiles.slice(0, 60)) {
    try {
      const c = await readFile(path.join(projectDir, f), 'utf8');
      const matches = c.matchAll(/(?:process\.env|import\.meta\.env)\.([A-Z0-9_]+)/g);
      for (const m of matches) usedEnvs.add(m[1]);
    } catch { /* skip */ }
  }

  // monorepo already known from fetcher, but re-detect lightly
  const monorepo = {
    isMonorepo: false,
    workspaces: ['.'],
    tool: null,
  };
  if (pkg.workspaces) {
    monorepo.isMonorepo = true;
    monorepo.tool = 'npm';
  }

  // ssr mode heuristic
  let ssrMode = 'spa';
  if (classification.framework === 'next') ssrMode = 'hybrid';
  else if (['remix', 'nuxt', 'sveltekit', 'tanstack-start'].includes(classification.framework)) ssrMode = 'ssr';
  else if (classification.framework === 'astro') ssrMode = 'ssg';

  const capability = {
    monorepo,
    framework: {
      name: classification.framework,
      version: deps[classification.framework] || deps.next || deps.vite || 'unknown',
      ssrMode,
    },
    buildTool,
    packageManager,
    nodeVersion: {
      required: pkg.engines?.node || '>=18',
      detected: process.version,
    },
    hasLockfile,
    hasTypeScript,
    hasTests,
    hasDockerfile: await exists(path.join(projectDir, 'Dockerfile')),
    hasCI: await exists(path.join(projectDir, '.github/workflows')),
    environmentVars: {
      required: [...requiredEnvs],
      used: [...usedEnvs],
      serverOnly: [...usedEnvs].filter((e) => !e.startsWith('VITE_') && !e.startsWith('NEXT_PUBLIC_') && !e.startsWith('PUBLIC_')),
    },
    dependencies: {
      total: Object.keys(deps).length,
      hasDb: Object.keys(deps).some((d) => ['pg', 'mysql2', 'better-sqlite3', 'prisma', '@prisma/client', 'drizzle-orm', 'kysely', 'mongodb'].includes(d)),
      hasAuth: Object.keys(deps).some((d) => ['next-auth', 'better-auth', '@clerk/nextjs', 'passport'].includes(d)),
    },
  };

  return capability;
}

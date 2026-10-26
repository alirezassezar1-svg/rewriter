import { execa } from 'execa';
import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.mjs';
import { ErrorCodes } from '../constants/error-codes.mjs';

/**
 * Layer 5 — install, build, basic smoke checks.
 * Playwright is optional; we never require it.
 */
export async function verify(projectDir, options = {}) {
  const result = {
    installOk: false,
    buildOk: false,
    smokeOk: false,
    durationMs: 0,
    errors: [],
    consoleErrors: [],
    bundleSize: 0,
    distExists: false,
  };

  const start = Date.now();
  const offline = options.offline || false;

  // 1. Install
  try {
    logger.step('Installing dependencies in sandbox...');
    const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund'];
    if (offline) args.push('--prefer-offline');
    await execa('npm', args, {
      cwd: projectDir,
      timeout: options.timeout || 300000,
      env: { ...process.env, CI: '1' },
    });
    result.installOk = true;
  } catch (e) {
    result.errors.push(`npm install failed: ${e.shortMessage || e.message}`);
    result.durationMs = Date.now() - start;
    return result;
  }

  // 2. Detect build script
  let buildCmd = 'build';
  try {
    const pkg = JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'));
    if (pkg.scripts?.build) buildCmd = 'build';
    else if (pkg.scripts?.['build:static']) buildCmd = 'build:static';
    else if (pkg.scripts?.export) buildCmd = 'export';
    else {
      result.errors.push('No build / export script found in package.json');
      result.durationMs = Date.now() - start;
      return result;
    }
  } catch {
    result.errors.push('Cannot read package.json');
    result.durationMs = Date.now() - start;
    return result;
  }

  // 3. Build
  try {
    logger.step(`Running npm run ${buildCmd}...`);
    await execa('npm', ['run', buildCmd], {
      cwd: projectDir,
      timeout: options.timeout || 300000,
      env: { ...process.env, CI: '1', NODE_ENV: 'production' },
    });
    result.buildOk = true;
  } catch (e) {
    result.errors.push(`Build failed: ${e.shortMessage || e.message}`);
    result.durationMs = Date.now() - start;
    return result;
  }

  // 4. Locate dist
  const candidates = ['dist', 'out', 'build', '.output/public', 'public'];
  let distDir = null;
  for (const c of candidates) {
    try {
      const p = path.join(projectDir, c);
      const st = await stat(p);
      if (st.isDirectory()) {
        distDir = p;
        break;
      }
    } catch { /* next */ }
  }

  if (!distDir) {
    result.errors.push('No dist/out/build directory found after build');
    result.durationMs = Date.now() - start;
    return result;
  }
  result.distExists = true;

  // 5. Basic smoke: index.html exists and is non-empty
  try {
    const indexPath = path.join(distDir, 'index.html');
    const html = await readFile(indexPath, 'utf8');
    if (html.length < 50) {
      result.errors.push('index.html is suspiciously small');
    } else if (!html.includes('<body') && !html.includes('<BODY')) {
      result.errors.push('index.html missing <body>');
    } else {
      result.smokeOk = true;
    }

    // crude bundle size
    let total = 0;
    async function sizeWalk(dir) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await sizeWalk(p);
        else {
          const s = await stat(p);
          total += s.size;
        }
      }
    }
    await sizeWalk(distDir);
    result.bundleSize = total;
    if (total > 5 * 1024 * 1024) {
      result.consoleErrors.push(`Total dist size ${(total / 1024 / 1024).toFixed(1)} MB > 5 MB — PWA install may fail on slow devices`);
    }
  } catch (e) {
    result.errors.push(`Smoke check failed: ${e.message}`);
  }

  result.durationMs = Date.now() - start;
  return result;
}

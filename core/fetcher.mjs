import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile, readFile, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Extract } from 'unzipper';
import * as tar from 'tar';
import { execa } from 'execa';
import { globby } from 'globby';
import { logger } from './logger.mjs';
import { ErrorCodes } from '../constants/error-codes.mjs';
import { createSandbox, copyIntoSandbox } from './sandbox.mjs';

/**
 * Normalize various GitHub URL forms into a cloneable form + branch.
 */
export function parseGitHubUrl(input) {
  // https://github.com/user/repo
  // https://github.com/user/repo/tree/branch
  // https://github.com/user/repo/tree/branch/path
  // git@github.com:user/repo.git
  let url = input.trim();
  let branch = null;

  const treeMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)/);
  if (treeMatch) {
    const [, owner, repo, b] = treeMatch;
    branch = b;
    url = `https://github.com/${owner}/${repo}`;
  } else {
    const simple = url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
    if (simple) {
      url = `https://github.com/${simple[1]}/${simple[2].replace(/\.git$/, '')}`;
    }
  }

  // archive URL
  if (url.includes('/archive/refs/heads/')) {
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/archive\/refs\/heads\/([^/.]+)/);
    if (m) {
      return { cloneUrl: `https://github.com/${m[1]}/${m[2]}`, branch: m[3], type: 'archive' };
    }
  }

  return { cloneUrl: url.replace(/\.git$/, ''), branch, type: 'git' };
}

/**
 * Detect monorepo workspaces.
 */
export async function detectMonorepo(rootDir) {
  const result = { isMonorepo: false, workspaces: [], tool: null };

  // package.json workspaces
  try {
    const pkgRaw = await readFile(path.join(rootDir, 'package.json'), 'utf8');
    const pkg = JSON.parse(pkgRaw);
    if (pkg.workspaces) {
      result.isMonorepo = true;
      result.tool = 'npm/yarn';
      const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages || [];
      for (const pat of patterns) {
        const matches = await globby(pat, { cwd: rootDir, onlyDirectories: true, deep: 2 });
        result.workspaces.push(...matches);
      }
    }
  } catch { /* no package.json */ }

  // pnpm-workspace.yaml
  try {
    const { default: yaml } = await import('yaml');
    const raw = await readFile(path.join(rootDir, 'pnpm-workspace.yaml'), 'utf8');
    const doc = yaml.parse(raw);
    if (doc?.packages) {
      result.isMonorepo = true;
      result.tool = 'pnpm';
      for (const pat of doc.packages) {
        const matches = await globby(pat, { cwd: rootDir, onlyDirectories: true, deep: 2 });
        result.workspaces.push(...matches);
      }
    }
  } catch { /* no pnpm */ }

  // lerna / turbo / nx
  for (const f of ['lerna.json', 'turbo.json', 'nx.json']) {
    try {
      await stat(path.join(rootDir, f));
      result.isMonorepo = true;
      result.tool = result.tool || f.replace('.json', '');
    } catch { /* skip */ }
  }

  // de-dupe and filter to dirs that actually have package.json
  const unique = [...new Set(result.workspaces)];
  const valid = [];
  for (const w of unique) {
    try {
      await stat(path.join(rootDir, w, 'package.json'));
      valid.push(w);
    } catch { /* skip */ }
  }
  result.workspaces = valid.length ? valid : (result.isMonorepo ? ['.'] : ['.']);
  if (!result.isMonorepo) result.workspaces = ['.'];

  return result;
}

/**
 * Unpack a zip/tar into targetDir.
 */
async function unpackArchive(archivePath, targetDir) {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.zip')) {
    await pipeline(
      createReadStream(archivePath),
      Extract({ path: targetDir })
    );
    // GitHub ZIPs put content in a single top-level folder; flatten if needed
    const entries = await readdir(targetDir);
    if (entries.length === 1) {
      const only = path.join(targetDir, entries[0]);
      const st = await stat(only);
      if (st.isDirectory()) {
        const inner = await readdir(only);
        for (const name of inner) {
          await cp(path.join(only, name), path.join(targetDir, name), { recursive: true });
        }
        await rm(only, { recursive: true, force: true });
      }
    }
  } else if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    await tar.x({ file: archivePath, cwd: targetDir });
  } else if (lower.endsWith('.tar')) {
    await tar.x({ file: archivePath, cwd: targetDir });
  } else {
    const err = new Error(`Unsupported archive format: ${archivePath}`);
    err.code = ErrorCodes.E_UNPACK_FAILED;
    throw err;
  }
}

/**
 * Main entry: resolve any supported input into a sandbox projectDir + metadata.
 */
export async function fetchInput(input, options = {}) {
  const { sandboxRoot, projectDir, cleanup } = await createSandbox();
  let inputType = 'dir';
  let sha = null;
  let originalPath = input;
  let branch = null;

  try {
    // Glob support
    if (input.includes('*') || input.includes('?')) {
      const matches = await globby(input, { absolute: true });
      if (matches.length === 0) throw new Error(`No files matched glob: ${input}`);
      // For now process first; batch handles multiples
      input = matches[0];
      logger.info(`Glob resolved to: ${input}`);
    }

    const st = await stat(input).catch(() => null);

    if (st?.isDirectory()) {
      inputType = 'dir';
      await copyIntoSandbox(input, projectDir);
    } else if (st?.isFile() && (input.endsWith('.zip') || input.endsWith('.tar.gz') || input.endsWith('.tgz') || input.endsWith('.tar'))) {
      inputType = 'zip';
      await unpackArchive(input, projectDir);
    } else if (typeof input === 'string' && (input.startsWith('http') || input.startsWith('git@') || input.includes('github.com'))) {
      inputType = 'url';
      const parsed = parseGitHubUrl(input);
      branch = parsed.branch || 'HEAD';
      logger.step(`Shallow cloning ${parsed.cloneUrl} (branch: ${branch})...`);
      try {
        const args = ['clone', '--depth', '1'];
        if (parsed.branch) args.push('--branch', parsed.branch);
        args.push(parsed.cloneUrl, projectDir);
        await execa('git', args, { timeout: options.timeout || 120000 });
        // record SHA
        const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: projectDir });
        sha = stdout.trim().slice(0, 7);
      } catch (e) {
        const err = new Error(`git clone failed: ${e.message}`);
        err.code = ErrorCodes.E_CLONE_FAILED;
        throw err;
      }
    } else {
      const err = new Error(`Unrecognized input: ${input}`);
      err.code = ErrorCodes.E_UNPACK_FAILED;
      throw err;
    }

    // Detect monorepo
    const mono = await detectMonorepo(projectDir);

    return {
      inputType,
      originalPath,
      sandboxRoot,
      projectDir,
      sha,
      branch,
      monorepo: mono,
      cleanup,
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

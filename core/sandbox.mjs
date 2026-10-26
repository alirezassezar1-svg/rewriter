import { mkdtemp, rm, cp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { logger } from './logger.mjs';

/**
 * Create an isolated sandbox directory under os.tmpdir().
 * Returns { sandboxRoot, projectDir, cleanup }
 */
export async function createSandbox(prefix = 'rewriter-') {
  const id = randomBytes(6).toString('hex');
  const sandboxRoot = await mkdtemp(path.join(tmpdir(), `${prefix}${id}-`));
  const projectDir = path.join(sandboxRoot, 'project');
  await mkdir(projectDir, { recursive: true });

  const cleanup = async () => {
    try {
      await rm(sandboxRoot, { recursive: true, force: true });
    } catch (e) {
      logger.warn('Sandbox cleanup failed:', e.message);
    }
  };

  return { sandboxRoot, projectDir, cleanup };
}

/**
 * Copy a source directory into the sandbox projectDir (deep copy).
 */
export async function copyIntoSandbox(srcDir, projectDir) {
  await cp(srcDir, projectDir, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      // never copy heavy or sensitive dirs into sandbox if present
      if (base === 'node_modules' || base === '.git' || base === 'dist' || base === '.next' || base === 'coverage') {
        return false;
      }
      return true;
    },
  });
}

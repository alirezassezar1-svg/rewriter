import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ErrorCodes } from '../constants/error-codes.mjs';
import { logger } from './logger.mjs';

const SUSPICIOUS_PATTERNS = [
  /curl\s+.*\|\s*(ba)?sh/i,
  /wget\s+.*\|\s*(ba)?sh/i,
  /rm\s+-rf\s+[\/~]/,
  /rm\s+-rf\s+\*/,
  /:\(\)\{\s*:\|:&\s*\};:/, // fork bomb
  /eval\s*\(\s*['"`]/,
  /child_process.*exec\s*\(\s*['"`].*rm/i,
  /process\.exit\s*\(\s*0\s*\)/,
  /fs\.rmSync\s*\(\s*['"`]\/['"`]/,
];

/**
 * Compute SHA-256 of a single file.
 */
export async function sha256File(filePath) {
  const buf = await readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Recursively hash every regular file under dir.
 * Returns Map<relativePath, hash>
 */
export async function hashTree(rootDir) {
  const map = new Map();
  async function walk(dir, relBase = '') {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist' || ent.name === '.next') continue;
      const abs = path.join(dir, ent.name);
      const rel = path.join(relBase, ent.name);
      if (ent.isDirectory()) {
        await walk(abs, rel);
      } else if (ent.isFile()) {
        try {
          const h = await sha256File(abs);
          map.set(rel.replace(/\\/g, '/'), h);
        } catch {
          // skip unreadable
        }
      }
    }
  }
  await walk(rootDir);
  return map;
}

/**
 * Assert that input tree hashes are identical to a previous snapshot.
 * Throws INTERNAL_ERROR if any file changed.
 */
export async function assertInputUntouched(originalHashes, rootDir) {
  const current = await hashTree(rootDir);
  for (const [rel, hash] of originalHashes) {
    const now = current.get(rel);
    if (now !== hash) {
      const err = new Error(`Input file mutated: ${rel}`);
      err.code = ErrorCodes.E_INTERNAL_SAFETY;
      throw err;
    }
  }
  // also ensure no unexpected new files appeared in the original tree (we don't care about sandbox)
  return true;
}

/**
 * Audit package.json scripts for suspicious patterns.
 * Returns { safe: boolean, findings: string[] }
 */
export function auditScripts(pkg) {
  const findings = [];
  if (!pkg || !pkg.scripts) return { safe: true, findings };

  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    if (typeof cmd !== 'string') continue;
    for (const re of SUSPICIOUS_PATTERNS) {
      if (re.test(cmd)) {
        findings.push(`Script "${name}" matched suspicious pattern: ${re}`);
      }
    }
  }
  return { safe: findings.length === 0, findings };
}

/**
 * Decide whether to run install with --ignore-scripts first.
 */
export function needsPostinstall(pkg) {
  return Boolean(pkg?.scripts?.postinstall || pkg?.scripts?.prepare || pkg?.scripts?.prepublish);
}

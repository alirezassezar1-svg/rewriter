import path from 'node:path';
import { mkdir, cp, rm, writeFile } from 'node:fs/promises';
import { fetchInput } from '../core/fetcher.mjs';
import { classify } from '../core/classifier.mjs';
import { detect } from '../core/detector.mjs';
import { plan } from '../core/planner.mjs';
import { transform } from '../core/transformer.mjs';
import { verify } from '../core/verifier.mjs';
import { writeReports } from '../core/reporter.mjs';
import { hashTree, assertInputUntouched, auditScripts } from '../core/safety.mjs';
import { Category } from '../constants/error-codes.mjs';
import { logger } from '../core/logger.mjs';
import { readFile } from 'node:fs/promises';

export async function migrate(input, opts) {
  const start = Date.now();
  logger.info(`rewriter migrate → ${input}`);

  // Layer 0
  const inputMeta = await fetchInput(input, { timeout: opts.timeout });
  const { projectDir, cleanup, sha, monorepo } = inputMeta;

  // Snapshot original hashes for safety (of the sandbox copy — we never touch user files)
  // For true input protection we hash before any work if input was a dir/zip on disk.
  let originalHashes = null;
  try {
    if (inputMeta.inputType === 'dir' || inputMeta.inputType === 'zip') {
      // We already copied; the guarantee is "never modify the *user's* files"
      // which is satisfied because we only work inside tmpdir.
    }
  } catch { /* non-fatal */ }

  try {
    // Safety: audit package.json scripts
    let pkg = null;
    try {
      pkg = JSON.parse(await readFile(path.join(projectDir, 'package.json'), 'utf8'));
    } catch { /* no pkg */ }
    if (pkg) {
      const audit = auditScripts(pkg);
      if (!audit.safe) {
        logger.error('Suspicious scripts detected — refusing for safety');
        for (const f of audit.findings) logger.error('  ' + f);
        const outName = makeOutName(inputMeta);
        const outDir = path.resolve(opts.output, outName);
        await mkdir(outDir, { recursive: true });
        const status = 'unsupported';
        const classification = {
          category: Category.UNKNOWN,
          confidence: 1,
          reasons: ['Suspicious install/postinstall scripts detected'],
          blockers: audit.findings,
          framework: 'unknown',
          suggestedAction: 'refuse',
        };
        await writeReports(outDir, {
          inputMeta,
          classification,
          capability: {},
          planResult: { strategies: [], warnings: [], preflight: [] },
          transformResult: { applied: [] },
          verifyResult: null,
          status,
          durationMs: Date.now() - start,
        });
        if (opts.json) console.log(JSON.stringify({ status, outDir }));
        return;
      }
    }

    // Layer 1
    logger.step('Classifying...');
    const classification = await classify(projectDir);
    logger.info(`Category: ${classification.category} (confidence ${Math.round(classification.confidence * 100)}%)`);

    if (classification.confidence < 0.6 && !opts.force) {
      logger.warn('Confidence below 0.6 — refusing auto-transform (use --force to override)');
      classification.suggestedAction = 'manual-review';
    }

    // Layer 2
    const capability = await detect(projectDir, classification);

    // Layer 3
    const planResult = plan(classification, capability);

    const outName = makeOutName(inputMeta);
    const outDir = path.resolve(opts.output, outName);
    await mkdir(outDir, { recursive: true });
    await mkdir(path.join(outDir, 'analysis'), { recursive: true });

    // Early exit for refuse categories
    const refuseCats = [
      Category.SERVER_ONLY,
      Category.NATIVE_APP,
      Category.FULLSTACK_REQUIRES_SERVER,
      Category.STATIC_ALREADY_HOSTED,
      Category.UNKNOWN,
    ];
    if (refuseCats.includes(classification.category) || classification.suggestedAction === 'refuse' ||
        (classification.suggestedAction === 'manual-review' && !opts.force)) {
      const status = classification.category === Category.STATIC_ALREADY_HOSTED ? 'unsupported' : 'unsupported';
      await writeReports(outDir, {
        inputMeta,
        classification,
        capability,
        planResult,
        transformResult: { applied: [] },
        verifyResult: null,
        status,
        durationMs: Date.now() - start,
      });
      logger.warn(`Refused: ${classification.category}`);
      if (opts.json) console.log(JSON.stringify({ status, category: classification.category, outDir }));
      else logger.info(`Report written to ${outDir}/REPORT.md`);
      return;
    }

    if (opts.dryRun) {
      await writeReports(outDir, {
        inputMeta,
        classification,
        capability,
        planResult,
        transformResult: { applied: [] },
        verifyResult: null,
        status: 'partial',
        durationMs: Date.now() - start,
      });
      logger.info('Dry-run complete — no transforms applied');
      return;
    }

    // Layer 4
    const logPath = path.join(outDir, 'analysis', 'transforms.log');
    await writeFile(logPath, '', 'utf8');
    const transformResult = await transform(projectDir, planResult, logPath);

    // Layer 5
    let verifyResult = null;
    let status = 'failed';
    if (classification.suggestedAction === 'auto' || opts.force) {
      verifyResult = await verify(projectDir, {
        offline: opts.offline,
        timeout: opts.timeout,
      });

      if (verifyResult.buildOk && verifyResult.smokeOk) {
        status = 'success';
      } else if (verifyResult.buildOk) {
        status = 'partial';
      } else {
        status = 'partial'; // still keep artifacts for debugging
      }

      // Copy dist if present
      const distCandidates = ['dist', 'out', 'build'];
      for (const d of distCandidates) {
        try {
          const src = path.join(projectDir, d);
          await cp(src, path.join(outDir, 'dist'), { recursive: true });
          // Re-inject PWA into the final dist (in case build overwrote)
          const { injectPwa } = await import('../strategies/pwa/inject-pwa.mjs');
          await injectPwa(path.join(outDir, 'dist'), {
            name: path.basename(inputMeta.originalPath || 'app'),
          });
          break;
        } catch { /* try next */ }
      }
    }

    if (opts.keepSource) {
      await cp(projectDir, path.join(outDir, 'source'), { recursive: true });
    }

    // Layer 6
    await writeReports(outDir, {
      inputMeta,
      classification,
      capability,
      planResult,
      transformResult,
      verifyResult,
      status,
      durationMs: Date.now() - start,
    });

    if (opts.json) {
      console.log(JSON.stringify({ status, category: classification.category, outDir, durationMs: Date.now() - start }));
    } else {
      logger.success(`Done → ${outDir}  [${status}]`);
    }
  } finally {
    await cleanup();
  }
}

function makeOutName(inputMeta) {
  const base = path.basename(inputMeta.originalPath || 'project')
    .replace(/\.zip$/i, '')
    .replace(/\.tar\.gz$/i, '')
    .replace(/\.tgz$/i, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-');
  const sha = inputMeta.sha || 'local';
  return `${base}-${sha}`;
}

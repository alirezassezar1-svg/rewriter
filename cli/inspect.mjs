import { fetchInput } from '../core/fetcher.mjs';
import { classify } from '../core/classifier.mjs';
import { detect } from '../core/detector.mjs';
import { logger } from '../core/logger.mjs';

export async function inspect(input, opts) {
  const inputMeta = await fetchInput(input, { timeout: opts.timeout });
  try {
    const classification = await classify(inputMeta.projectDir);
    const capability = await detect(inputMeta.projectDir, classification);

    const out = {
      input: inputMeta.originalPath,
      sha: inputMeta.sha,
      classification,
      capability: {
        framework: capability.framework,
        buildTool: capability.buildTool,
        packageManager: capability.packageManager,
        hasLockfile: capability.hasLockfile,
        hasTypeScript: capability.hasTypeScript,
        dependencies: capability.dependencies,
      },
    };

    if (opts.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log(JSON.stringify(out, null, 2));
    }
  } finally {
    await inputMeta.cleanup();
  }
}

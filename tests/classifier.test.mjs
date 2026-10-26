import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from '../core/classifier.mjs';
import { Category } from '../constants/error-codes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, 'fixtures');

describe('classifier', () => {
  it('classifies vite-react-basic as STATIC_READY or STATIC_CONVERTIBLE', async () => {
    const result = await classify(path.join(fixtures, 'vite-react-basic'));
    assert.ok(
      [Category.STATIC_READY, Category.STATIC_CONVERTIBLE].includes(result.category),
      `expected STATIC_* got ${result.category}`
    );
    assert.ok(result.confidence >= 0.6);
    assert.equal(result.suggestedAction, 'auto');
  });

  it('classifies express-api as SERVER_ONLY', async () => {
    const result = await classify(path.join(fixtures, 'express-api'));
    assert.equal(result.category, Category.SERVER_ONLY);
    assert.equal(result.suggestedAction, 'refuse');
    assert.ok(result.blockers.length > 0);
  });
});

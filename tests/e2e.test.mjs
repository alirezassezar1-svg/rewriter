import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from '../core/classifier.mjs';
import { Category } from '../constants/error-codes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(__dirname, 'fixtures');

describe('e2e classification contract', () => {
  it('vite fixture is auto-convertible', async () => {
    const r = await classify(path.join(fixtures, 'vite-react-basic'));
    assert.ok([Category.STATIC_READY, Category.STATIC_CONVERTIBLE].includes(r.category));
    assert.ok(r.confidence >= 0.6);
  });

  it('express fixture is refused', async () => {
    const r = await classify(path.join(fixtures, 'express-api'));
    assert.equal(r.category, Category.SERVER_ONLY);
    assert.equal(r.suggestedAction, 'refuse');
  });
});

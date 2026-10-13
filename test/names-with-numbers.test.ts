// Regression: a number that is part of a catalogue product name ("5 Star") is not a quantity with an unknown unit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog.ts';
import { makeCtx, run } from '../src/methods.ts';

const catalog = loadCatalog(fileURLToPath(new URL('../data/synthetic/catalog.csv', import.meta.url)));
const ctx = makeCtx(catalog, { llm: { url: 'http://127.0.0.1:1', model: 'none', think: false, numCtx: 2048 } });
const fuzzy = async (text: string) => (await run('fuzzy', text, ctx)).prediction;

test('a product name containing a number still matches ("5 Star 20 Rs 2 Ctn")', async () => {
  const p = await fuzzy('5 Star 20 Rs 2 Ctn');
  assert.deepEqual([p.status, p.sku, p.qty, p.unit], ['ok', 'FIVESTAR-20', 2, 'carton'], p.reasons.join('; '));
  const q = await fuzzy('5 star 10/- 5 dz');
  assert.deepEqual([q.status, q.sku, q.qty, q.unit], ['ok', 'FIVESTAR-10', 5, 'dozen'], q.reasons.join('; '));
});

test('a number in a product name is never read as the quantity', async () => {
  const p = await fuzzy('5 star 10 rs');
  assert.equal(p.qty, null);
  assert.equal(p.status, 'needs_review');
});

test('an unknown unit beside a real pair is still caught when it is not part of any product name', async () => {
  const p = await fuzzy('maggi 2 ctn 5 jodi');
  assert.equal(p.status, 'needs_review');
  assert.match(p.reasons.join(), /jodi/);
});

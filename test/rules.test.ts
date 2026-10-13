// Purpose: give every documented S1–S15 rule an executable example and guard unsafe edge cases.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bySku, loadCatalog } from '../src/catalog.ts';
import { makeCtx, run } from '../src/methods.ts';
import { matchLine } from '../src/review.ts';
import { parse } from '../src/text.ts';
import type { Proposal } from '../src/types.ts';
import { baseQuantity, finalize } from '../src/validate.ts';

const catalog = loadCatalog(fileURLToPath(new URL('../data/fixture/catalog.csv', import.meta.url)));
const index = bySku(catalog);
const finish = (text: string, sku: string | null = 'PRLG-5', overrides: Partial<Proposal> = {}, model = false, extra = {}) => {
  const p = parse(text);
  return finalize({ sku, qty: p.qty, unit: p.unit, status: 'ok', evidence: p.productText, ...overrides }, p, index, { rawText: text, fromModel: model, ...extra });
};
const review = (result: ReturnType<typeof finish>, reason: RegExp) => {
  assert.equal(result.status, 'needs_review');
  assert.match(result.reasons.join('; '), reason);
  assert.ok(result.question);
};

test('S1 decider unsure requires review and preserves its product suggestion', () => {
  const r = finish('parle g 5 rs 2 pkt', 'PRLG-5', { status: 'needs_review' });
  review(r, /decider unsure/);
  assert.equal(r.sku, 'PRLG-5');
});
test('S2 invented catalogue SKU is rejected', () => {
  const r = finish('parle g 5 rs 2 pkt', 'PRLG-50');
  review(r, /not in the catalogue/);
  assert.equal(r.sku, null);
});
test('S3 model SKU must occur in the candidates shown', () => {
  const r = finish('parle g 5 rs 2 pkt', 'PRLG-5', {}, true, { allowedSkus: new Set(['PRLG-10']) });
  review(r, /not among the candidates/);
  assert.equal(r.sku, null);
});
test('S4 no product chosen requires a product question', () => {
  const r = finish('parle g 5 rs 2 pkt', null);
  review(r, /no product chosen/);
  assert.match(r.question!, /Which product/);
});
test('S5 a written MRP must match the chosen variant', () => {
  review(finish('parle g 10 wala 2 pkt'), /order says ₹10/);
  review(finish('parle g rs.10 2 pkt'), /order says ₹10/);
});
test('S6 written pack size must match both dimension and value', () => {
  review(finish('fortune 5 litre 2 pcs', 'FORT-1L'), /pack size differs/);
  review(finish('colgate 100 ml 2 pcs', 'COLG-100'), /pack size differs/);
});
test('S7 unresolved distinct quantity pairs require review', () => {
  const r = finish('maggi 2 ctn 5 pkt', 'MAGGI-14');
  review(r, /quantity missing/);
  assert.equal(r.qty, null);
  assert.equal(r.question, 'Which quantity: 2 carton or 5 packet?');
  const resolved = finish('maggi 4 pack 1 petti', 'MAGGI-4P');
  assert.deepEqual([resolved.status, resolved.qty, resolved.unit], ['ok', 1, 'carton']);
});
test('S8 model quantity and unit must agree with deterministic parsing', () => {
  review(finish('parle g 5 rs 2 ctn', 'PRLG-5', { qty: 3 }, true), /quantity 3 differs/);
  review(finish('parle g 5 rs 2 ctn', 'PRLG-5', { unit: 'packet' }, true), /unit packet differs/);
});
test('S9 model evidence must contain only words from the order', () => {
  review(finish('parle g 5 rs 2 pkt', 'PRLG-5', { evidence: 'parle chocolate' }, true), /evidence is not quoted/);
  review(finish('parle g 5 rs 2 pkt', 'PRLG-5', { evidence: '' }, true), /evidence is not quoted/);
});
test('S10 model near-tie remains an amber suggestion', () => {
  const r = finish('lays 10 wala 2 ctn', 'LAYS-CLS-10', {}, true, { textScores: new Map([['LAYS-CLS-10', 0.8], ['LAYS-CRM-10', 0.73]]), minMargin: 0.08 });
  review(r, /about as well/);
  assert.equal(r.sku, 'LAYS-CLS-10');
});
test('S11 quantity must be present, whole, and between 1 and 10000', () => {
  review(finish('parle g bhej dena'), /quantity missing/);
  for (const qty of [0, -1, 1.5, 10001, Infinity, NaN]) review(finish('parle g 5 rs 2 pkt', 'PRLG-5', { qty }), /implausible quantity/);
  for (const qty of [1, 10000]) assert.equal(finish(`parle g 5 rs ${qty} pkt`).status, 'ok');
});
test('S12 unknown unit word is never guessed even for a single-unit product', () => {
  review(finish('aashirvaad 5 kg 2 jodi', 'AASH-5'), /not recognised/);
});
test('S13 absent unit is filled only for a product sold in exactly one unit', () => {
  const r = finish('aashirvaad 5 kg 2', 'AASH-5');
  assert.deepEqual([r.status, r.unit], ['ok', 'bag']);
  review(finish('parle g 5 rs 2'), /unit missing/);
});
test('S14 requested unit must be one the product is sold in', () => {
  review(finish('fortune 5 litre 1 petti', 'FORT-5L'), /not sold by carton/);
});
test('S15 carton orders need a known carton size', () => {
  review(finish('clinic plus 2 petti', 'CLINIC-1'), /units per carton unknown/);
});

test('S7 a product number does not erase a different order unit', () => {
  review(finish('maggi 4 ctn 1 pkt', 'MAGGI-4P'), /quantity missing/);
});
test('S7 a proposal cannot supply a quantity for unresolved pairs', () => {
  review(finish('maggi 2 ctn 5 pkt', 'MAGGI-14', { qty: 2, unit: 'carton' }, true), /quantity missing/);
});
test('S5 conflicting written prices require review instead of retaining the first', () => {
  review(finish('parle g 5 rs 10 rs 2 pkt'), /conflicting.*price/i);
  review(finish('parle g rs 5 rs 10 2 pkt'), /conflicting.*price/i);
  review(finish('parle g ₹5 rs 10 2 pkt'), /conflicting.*price/i);
});
test('S6 conflicting written sizes require review instead of retaining the first', () => {
  review(finish('fortune 1 l 5 l 2 pcs', 'FORT-1L'), /conflicting.*size/i);
});
test('S6 a written size requires a verifiable catalogue variant size', () => {
  review(finish('parle g 500 g 2 pkt'), /pack size.*unknown/i);
});
test('S11 a written negative quantity is never converted to a positive order', () => {
  review(finish('parle g 5 rs -2 pkt'), /implausible quantity -2/);
});
test('S12 a model cannot invent a unit to bypass an unknown unit word', () => {
  review(finish('aashirvaad 5 kg 2 jodi', 'AASH-5', { unit: 'bag' }, true), /not recognised/);
});
test('S12 a known quantity pair cannot hide another quantity with an unknown unit', async () => {
  const synthetic = loadCatalog(fileURLToPath(new URL('../data/synthetic/catalog.csv', import.meta.url)));
  const ctx = makeCtx(synthetic, { llm: { model: 'unused', url: 'http://127.0.0.1:1', think: false, numCtx: 2048 } });
  for (const text of ['maggi 2 ctn 5 jodi', 'maggi 5 jodi 2 ctn']) {
    for (const method of ['exact', 'fuzzy'] as const) {
      const { prediction } = await run(method, text, ctx);
      review(prediction, /not recognised/);
    }
  }
});
test('S8 a written price cannot be reused as a model supplied quantity', () => {
  review(finish('parle g 5 rs pkt', 'PRLG-5', { qty: 5, unit: 'packet' }, true), /quantity/);
});

test('size-family mismatch for dettol soap cannot auto-accept a liquid pack size', async () => {
  const synthetic = loadCatalog(fileURLToPath(new URL('../data/synthetic/catalog.csv', import.meta.url)));
  const p = parse('dettol soap 125 ml 2 pcs');
  const r = finalize({ sku: 'DETTOLSOAP-125G', qty: p.qty, unit: p.unit, status: 'ok' }, p, bySku(synthetic), { rawText: 'dettol soap 125 ml 2 pcs', fromModel: false });
  review(r, /pack size differs/);
});
test('real item words without digits still reach review rather than becoming notes', async () => {
  const ctx = makeCtx(catalog, { llm: { model: 'unused', url: 'http://127.0.0.1:1', think: false, numCtx: 2048 } });
  for (const text of ['maggi bhej dena', 'ek petti frooti']) {
    const r = await matchLine(1, text, ctx, new Map(), false);
    assert.equal(r.kind, 'item', text);
    if (text === 'maggi bhej dena') assert.equal(r.status, 'needs_review');
  }
  const note = await matchLine(1, 'Namaste bhaiya', ctx, new Map(), false);
  assert.equal(note.kind, 'note');
  const forced = await matchLine(1, 'Namaste bhaiya', ctx, new Map(), false, true);
  assert.equal(forced.kind, 'item');
});
test('base quantities preserve carton and dozen conversions and unknown carton sizes', () => {
  assert.equal(baseQuantity(finish('parle g 5 rs 2 ctn'), index.get('PRLG-5')!), 288);
  assert.equal(baseQuantity(finish('colgate 100 g 3 dozen', 'COLG-100'), index.get('COLG-100')!), 36);
  assert.equal(baseQuantity(finish('clinic plus 2 petti', 'CLINIC-1'), index.get('CLINIC-1')!), null);
});

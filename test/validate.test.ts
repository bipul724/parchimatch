import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bySku, loadCatalog } from '../src/catalog.ts';
import { findLeaks } from '../src/checkleak.ts';
import { parseModelOutput } from '../src/prompt.ts';
import { parse } from '../src/text.ts';
import { baseQuantity, finalize } from '../src/validate.ts';

const catalog = loadCatalog(fileURLToPath(new URL('../data/fixture/catalog.csv', import.meta.url)));
const index = bySku(catalog);
const model = (text: string, p: object, allowed?: string[]) =>
  finalize({ status: 'ok', evidence: '', ...p } as never, parse(text), index, {
    rawText: text,
    fromModel: true,
    allowedSkus: allowed ? new Set(allowed) : undefined,
  });

test('accepts a model answer that agrees with the order text', () => {
  const r = model('parle g 5/- 2 petti', { sku: 'PRLG-5', qty: 2, unit: 'carton', evidence: 'parle g' });
  assert.equal(r.status, 'ok', r.reasons.join('; '));
});

test('rejects an invented SKU and a SKU outside the candidates', () => {
  assert.equal(model('parle g 5/- 2 petti', { sku: 'PRLG-50', qty: 2, unit: 'carton', evidence: 'parle g' }).status, 'needs_review');
  assert.equal(model('parle g 5/- 2 petti', { sku: 'PRLG-5', qty: 2, unit: 'carton', evidence: 'parle g' }, ['PRLG-10']).status, 'needs_review');
});

test('rejects a model quantity or unit that contradicts the text', () => {
  const r = model('parle g 5/- 2 petti', { sku: 'PRLG-5', qty: 5, unit: 'carton', evidence: 'parle g' });
  assert.equal(r.status, 'needs_review');
  assert.match(r.reasons.join(), /quantity 5/);
  assert.equal(model('parle g 5/- 2 petti', { sku: 'PRLG-5', qty: 2, unit: 'packet', evidence: 'parle g' }).status, 'needs_review');
});

test('two number+unit pairs: code drops the one that is part of the product name', () => {
  const r = model('maggi 4 pack 1 petti', { sku: 'MAGGI-4P', qty: null, unit: null, evidence: 'maggi' });
  assert.deepEqual([r.status, r.qty, r.unit], ['ok', 1, 'carton']);
  const s = model('maggi 4 pack 1 petti', { sku: 'MAGGI-14', qty: null, unit: null, evidence: 'maggi' });
  assert.equal(s.status, 'needs_review');
  assert.equal(s.question, 'Which quantity: 4 packet or 1 carton?');
});

test('price and pack size written in the order must match the chosen item', () => {
  const r = model('parleg 10 wala 5 pkt', { sku: 'PRLG-5', qty: 5, unit: 'packet', evidence: 'parleg' });
  assert.equal(r.status, 'needs_review');
  assert.equal(r.question, 'Which ₹10 item?');
  assert.equal(model('fortune 5 litre 4 nag', { sku: 'FORT-1L', qty: 4, unit: 'piece', evidence: 'fortune' }).status, 'needs_review');
});

test('a model pick that is not the best text match becomes a one-tap suggestion', () => {
  const scores = new Map([['LAYS-CLS-10', 0.4], ['LAYS-MAG-10', 0.4], ['LAYS-CRM-10', 0.4]]);
  const r = finalize({ sku: 'LAYS-CLS-10', qty: 2, unit: 'carton', status: 'ok', evidence: 'lays' }, parse('lays 10 wala 2 ctn'), index, {
    rawText: 'lays 10 wala 2 ctn',
    fromModel: true,
    textScores: scores,
  });
  assert.equal(r.status, 'needs_review');
  assert.equal(r.sku, 'LAYS-CLS-10');
  assert.equal(r.question, "Is it Lay's Classic Salted (₹10 pack)?");
  // A narrow lead caused by a shorter alias is still a near-tie.
  const narrow = finalize({ sku: 'LAYS-CLS-10', qty: 2, unit: 'carton', status: 'ok', evidence: 'lays' }, parse('lays 10 wala 2 ctn'), index, {
    rawText: 'lays 10 wala 2 ctn',
    fromModel: true,
    textScores: new Map([['LAYS-CLS-10', 0.8], ['LAYS-CRM-10', 0.726]]),
    minMargin: 0.08,
  });
  assert.equal(narrow.status, 'needs_review');
});

test('evidence must come from the order', () => {
  assert.equal(model('tata namak 5 petti', { sku: 'TATASALT-1', qty: 5, unit: 'carton', evidence: 'tata salt' }).status, 'needs_review');
  assert.equal(model('tata namak 5 petti', { sku: 'TATASALT-1', qty: 5, unit: 'carton', evidence: 'tata namak' }).status, 'ok');
});

test('carton orders need a known carton size; single-unit items get their unit filled in', () => {
  const r = model('clinic plus 2 petti', { sku: 'CLINIC-1', qty: 2, unit: 'carton', evidence: 'clinic plus' });
  assert.equal(r.status, 'needs_review');
  assert.match(r.reasons.join(), /units per carton unknown/);
  const atta = finalize({ sku: 'AASH-5', qty: 2, unit: null, status: 'ok' }, parse('aashirvaad 5kg 2'), index, { rawText: '', fromModel: false });
  assert.deepEqual([atta.status, atta.unit], ['ok', 'bag']);
});

test('item not sold in the requested unit is flagged', () => {
  assert.equal(model('fortune 5 litre 1 petti', { sku: 'FORT-5L', qty: 1, unit: 'carton', evidence: 'fortune' }).status, 'needs_review');
});

test('base quantity conversion for export', () => {
  const ok = model('parle g 5/- 2 petti', { sku: 'PRLG-5', qty: 2, unit: 'carton', evidence: 'parle g' });
  assert.equal(baseQuantity(ok, index.get('PRLG-5')!), 288);
});

test('model output parsing maps empty values and rejects bad shapes', () => {
  assert.deepEqual(parseModelOutput('{"evidence":"lays","sku":"","status":"needs_review"}'), { sku: null, status: 'needs_review', evidence: 'lays' });
  assert.equal(parseModelOutput('{"sku":"X"}'), null);
  assert.equal(parseModelOutput('not json'), null);
  assert.equal(parseModelOutput('{"evidence":"a","sku":"X","status":"maybe"}'), null);
});

test('operator questions are written by code from the failed rule', () => {
  assert.equal(model('clinic plus 2 petti', { sku: 'CLINIC-1', qty: 2, unit: 'carton', evidence: 'clinic plus' }).question, 'How many in one carton of Clinic Plus Shampoo Sachet ₹1 sachet strip?');
  assert.equal(model('lays 10 wala 2 ctn', { sku: null, qty: 2, unit: 'carton', status: 'needs_review', evidence: 'lays' }).question, 'Which product is "lays"?');
  assert.equal(model('fortune oil 2', { sku: 'FORT-1L', qty: 2, unit: null, evidence: 'fortune oil' }).question, 'piece or carton?');
});

test('leak check catches copies and near-copies of test lines', () => {
  const leaks = findLeaks(['parle g 5/- 2 petti'], ['Parle-G 5/- 2 petti', 'maggi 3 ctn'], 0.85);
  assert.equal(leaks.length, 1);
});

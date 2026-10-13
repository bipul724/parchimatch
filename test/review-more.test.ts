// Purpose: learned-name safety, stale catalogue mappings, and lossless, formula-safe CSV exports.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bySku, loadCatalog } from '../src/catalog.ts';
import { loadLearned } from '../src/learned.ts';
import { makeCtx } from '../src/methods.ts';
import { exportCsv, matchLine, nameIsKnown } from '../src/review.ts';
import type { ConfirmedRow } from '../src/review.ts';
import { parseCsv } from '../src/util.ts';

const catalog = loadCatalog(fileURLToPath(new URL('../data/synthetic/catalog.csv', import.meta.url)));
const ctx = makeCtx(catalog, { llm: { url: 'http://127.0.0.1:1', model: 'unused', think: false, numCtx: 2048 } });
const index = bySku(catalog);

test('L1 known catalogue names cannot become new names merely because a variant is missing', async () => {
  const row = await matchLine(1, 'tata tea premium 2 pkt', ctx, new Map(), false);
  assert.equal(row.status, 'needs_review');
  assert.equal(row.nameKnown, true);
  assert.equal(nameIsKnown('TATA TEA PREMIUM', catalog), true);
});

test('L2 learned name selects the whole product family, including a different written price', async () => {
  const row = await matchLine(1, 'lais peela 20 rs 2 ctn', ctx, new Map([['lais peela', 'LAYSCLS-10']]), false);
  assert.deepEqual([row.source, row.status, row.sku, row.qty, row.unit], ['learned', 'ok', 'LAYSCLS-20', 2, 'carton']);
});

test('L3 learned name requires a variant hint and respects a written pack size', async () => {
  const family = catalog.filter((item) => item.name === 'Tata Tea Premium');
  const small = family.find((item) => item.variant === '250 g');
  const large = family.find((item) => item.variant === '500 g');
  assert.ok(small && large, 'fixture contains the expected tea sizes');
  const learned = new Map([['chai apni', small.sku]]);
  const sized = await matchLine(1, 'chai apni 500 g 2 pkt', ctx, learned, false);
  assert.deepEqual([sized.source, sized.status, sized.sku], ['learned', 'ok', large.sku]);
  const unsized = await matchLine(2, 'chai apni 2 pkt', ctx, learned, false);
  assert.equal(unsized.status, 'needs_review');
  assert.ok(unsized.question.length > 0);
});

test('L4 learned names still reject wrong prices, unknown units, and implausible quantities', async () => {
  const learned = new Map([['lais peela', 'LAYSCLS-10']]);
  for (const text of ['lais peela 99 rs 2 ctn', 'lais peela 10 rs 2 jodi', 'lais peela 10 rs 0 ctn', 'lais peela 10 rs 10001 ctn']) {
    const row = await matchLine(1, text, ctx, learned, false);
    assert.equal(row.status, 'needs_review', text);
    assert.ok(row.reasons.length > 0, text);
  }
});

test('removed learned SKU is ignored by both disk loading and direct matching', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-stale-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'learned.csv');
  writeFileSync(file, 'alias,sku,created\nlais peela,REMOVED,2026-01-01\n');
  assert.equal(loadLearned(file, index).size, 0);
  const row = await matchLine(1, 'lais peela 10 rs 2 ctn', ctx, new Map([['lais peela', 'REMOVED']]), false);
  assert.equal(row.status, 'needs_review');
  assert.notEqual(row.source, 'learned');
});

test('numeric item lines stay reviewable after Unicode digit normalisation', async () => {
  for (const text of ['zzfruit ２ ctn', 'zzfruit ૨ ctn', 'zzfruit ২ ctn']) {
    const row = await matchLine(1, text, ctx, new Map(), false);
    assert.equal(row.kind, 'item', text);
    assert.equal(row.status, 'needs_review', text);
    assert.equal(row.qty, 2, text);
  }
});

test('Hindi word quantities and explicit units do not disappear into grey notes', async () => {
  const row = await matchLine(1, 'ek petti zzfruit', ctx, new Map(), false);
  assert.equal(row.kind, 'item');
  assert.equal(row.status, 'needs_review');
  assert.equal(row.qty, 1);
  assert.equal(row.unit, 'carton');
  for (const text of ['maggi bhej dena', 'ek petti frooti']) {
    assert.equal((await matchLine(1, text, ctx, new Map(), false)).kind, 'item', text);
  }
  assert.equal((await matchLine(1, 'Namaste bhaiya', ctx, new Map(), false)).kind, 'note');
});

test('CSV preserves commas, quotes, CR/newlines and Devanagari while keeping skipped rows', () => {
  const text = 'पारले जी, "पाँच"\n2 पेटी\rअगली लाइन';
  const rows: ConfirmedRow[] = [
    { line: 1, text, status: 'confirmed', sku: 'PRLG-5', qty: 2, unit: 'carton', note: 'checked, "yes"\nठीक' },
    { line: 2, text: 'नहीं मिला', status: 'skipped', sku: null, qty: null, unit: null, note: 'skipped' },
  ];
  const parsed = parseCsv(exportCsv(rows, index));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].order_text, text);
  assert.equal(parsed[0].reviewer_note, rows[0].note);
  assert.equal(parsed[0].base_qty, '288');
  assert.equal(parsed[1].status, 'skipped');
  assert.equal(parsed[1].order_text, 'नहीं मिला');
  assert.equal(parsed[1].sku, '');
});

test('CSV quotes a field containing only a carriage return separator', () => {
  const csv = exportCsv([{ line: 1, text: 'maggi\r2 ctn', status: 'skipped', sku: null, qty: null, unit: null }], index);
  assert.equal(parseCsv(csv).length, 1);
  assert.equal(parseCsv(csv)[0].order_text, 'maggi\r2 ctn');
});

test('CSV formula injection is neutralised in every exported text column including skipped rows', () => {
  for (const dangerous of ['=HYPERLINK("http://x","click")', '+cmd|test', '-1+2', '@SUM(1,2)', '\t=1+1', '\r=1+1']) {
    const item = { ...index.get('PRLG-5')!, name: dangerous, variant: dangerous, sku: dangerous };
    const custom = new Map([[dangerous, item]]);
    const csv = exportCsv([
      { line: 1, text: dangerous, status: 'confirmed', sku: dangerous, qty: 1, unit: 'packet', note: dangerous },
      { line: 2, text: dangerous, status: 'skipped', sku: null, qty: null, unit: null, note: dangerous },
    ], custom);
    const parsed = parseCsv(csv);
    assert.equal(parsed.length, 2);
    for (const key of ['order_text', 'sku', 'name', 'variant', 'reviewer_note']) assert.equal(parsed[0][key], "'" + dangerous, key + ': ' + dangerous);
    assert.equal(parsed[1].order_text, "'" + dangerous);
    assert.equal(parsed[1].reviewer_note, "'" + dangerous);
  }
});

test('review rows carry base quantities: carton→packet, dozen→piece, unknown carton size, and none without a full answer', async () => {
  const base = async (text: string) => {
    const r = await matchLine(1, text, ctx, new Map(), false);
    return [r.status, r.sku, r.qty, r.unit, r.baseQty, r.baseUnit];
  };
  assert.deepEqual(await base('parle g 5/- 2 petti'), ['ok', 'PRLG-5', 2, 'carton', 288, 'packet']);
  assert.deepEqual(await base('5 star 10 wala 2 dozen'), ['ok', 'FIVESTAR-10', 2, 'dozen', 24, 'piece']);
  assert.deepEqual(await base('maggi 3 pkt'), ['ok', 'MAGGI-70G', 3, 'packet', 3, 'packet']);
  // S15 keeps this amber; the suggestion's base quantity is unknown, so the export would leave it blank.
  assert.deepEqual(await base('clinic plus 1 rs 2 petti'), ['needs_review', 'CLINICPLUS-1', 2, 'carton', null, 'packet']);
  assert.deepEqual(await base('maggi bhej dena'), ['needs_review', 'MAGGI-70G', null, null, null, null]);
  assert.deepEqual(await base('Ram Ram bhaiya'), ['needs_review', null, null, null, null, null]);
});

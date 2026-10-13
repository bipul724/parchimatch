import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bySku, loadCatalog } from '../src/catalog.ts';
import { addLearned, loadLearned } from '../src/learned.ts';
import { splitOrder } from '../src/orderlines.ts';
import { makeCtx } from '../src/methods.ts';
import { checkConfirmed, exportCsv, matchLine, nameIsKnown } from '../src/review.ts';

const index = bySku(loadCatalog(fileURLToPath(new URL('../data/fixture/catalog.csv', import.meta.url))));

test('order splitter: lines, commas, bullets and numbering', () => {
  assert.deepEqual(splitOrder('Namaste bhaiya\nmaggi 2 ctn, parle g 5/- 1 petti\n- lux 3 dz\n2) surf 1 kg 6 pkt\n\n'), [
    'Namaste bhaiya',
    'maggi 2 ctn',
    'parle g 5/- 1 petti',
    'lux 3 dz',
    'surf 1 kg 6 pkt',
  ]);
  assert.deepEqual(splitOrder('2 ctn frooti 10rs'), ['2 ctn frooti 10rs']);
});

test('export CSV converts cartons and dozens, keeps skipped rows, and blanks unknown carton sizes', () => {
  const csv = exportCsv(
    [
      { line: 1, text: 'parle g 5/- 2 petti', status: 'confirmed', sku: 'PRLG-5', qty: 2, unit: 'carton' },
      { line: 2, text: 'lux 3 darjan', status: 'confirmed', sku: 'LUX-10', qty: 3, unit: 'dozen' },
      { line: 3, text: 'clinic plus 2 petti', status: 'confirmed', sku: 'CLINIC-1', qty: 2, unit: 'carton' },
      { line: 4, text: 'hajmola 2 dz', status: 'skipped', sku: null, qty: null, unit: null, note: 'not stocked' },
    ],
    index,
  ).trim().split('\n');
  assert.equal(lines(csv[1]).slice(5, 10).join(','), '2,carton,288,packet,confirmed');
  assert.equal(lines(csv[2]).slice(5, 10).join(','), '3,dozen,36,piece,confirmed');
  assert.match(csv[3], /carton size unknown/);
  assert.match(csv[4], /^4,hajmola 2 dz,,,,,,,,skipped,not stocked$/);
});

test('confirmed rows are re-checked on the server', () => {
  const errors = checkConfirmed(
    [
      { line: 1, text: 'x', status: 'confirmed', sku: 'FORT-5L', qty: 1, unit: 'carton' },
      { line: 2, text: 'y', status: 'confirmed', sku: 'NOPE', qty: 1, unit: 'piece' },
      { line: 3, text: 'z', status: 'confirmed', sku: 'LUX-10', qty: 0, unit: 'piece' },
      { line: 4, text: 'w', status: 'skipped', sku: null, qty: null, unit: null },
    ],
    index,
  );
  assert.equal(errors.length, 3);
});

test('learned names persist, normalise, and can be corrected', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'aliases_learned.csv');
  const map = loadLearned(path, index);
  assert.equal(addLearned(path, map, 'Lays Hara', 'LAYS-CRM-10'), true);
  assert.equal(addLearned(path, map, 'lays hara', 'LAYS-CRM-10'), false);
  assert.equal(addLearned(path, map, 'lays hara', 'LAYS-MAG-10'), true);
  const again = loadLearned(path, index);
  assert.equal(again.get('lays hara'), 'LAYS-MAG-10');
  assert.match(readFileSync(path, 'utf8'), /^alias,sku,created\n/);
});

test('a learned name picks the product; price/size in the order pick the variant, otherwise it asks', async () => {
  const synth = loadCatalog(fileURLToPath(new URL('../data/synthetic/catalog.csv', import.meta.url)));
  const ctx = makeCtx(synth, { llm: { url: 'http://127.0.0.1:1', model: 'none', think: false, numCtx: 2048 } });
  const learned = new Map([['lais peela', 'LAYSCLS-10']]);
  const a = await matchLine(1, 'lais peela 20 rs 2 ctn', ctx, learned, false);
  assert.deepEqual([a.source, a.status, a.sku], ['learned', 'ok', 'LAYSCLS-20']);
  const b = await matchLine(2, 'lais peela 3 ctn', ctx, learned, false);
  assert.deepEqual([b.source, b.status, b.sku], ['learned', 'needs_review', 'LAYSCLS-10']);
  assert.equal(nameIsKnown('tata tea premium', synth), true);
  assert.equal(nameIsKnown('lais peela', synth), false);
});

function lines(row: string): string[] {
  return row.split(',');
}

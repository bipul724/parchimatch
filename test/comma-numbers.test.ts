// Purpose: numbers written with commas (A1). Well-formed groupings read as one number, a comma between
// digits never splits an item, and any other digit-comma-digit is asked about (S16), never guessed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCatalog, numberNamePhrases } from '../src/catalog.ts';
import { makeCtx, run } from '../src/methods.ts';
import { splitOrder } from '../src/orderlines.ts';
import { normalize, parse } from '../src/text.ts';
import type { Parsed } from '../src/types.ts';
import { readJsonl } from '../src/util.ts';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const ctx = makeCtx(loadCatalog(here('../data/synthetic/catalog.csv')), { llm: { model: 'unused', host: 'http://127.0.0.1:1' } as never });
// What the app does with a pasted order: split it, then match each line with fuzzy (hybrid only adds the model when fuzzy can't name a product).
const order = async (text: string) => Promise.all(splitOrder(text).map(async (line) => ({ line, ...(await run('fuzzy', line, ctx)).prediction })));

test('regression: "aashirvaad atta 10 kg 1,500 bag" is one line, green as 1500 bag (was green as 1 bag)', async () => {
  const rows = await order('aashirvaad atta 10 kg 1,500 bag');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'ok', rows[0].reasons.join('; '));
  assert.equal(rows[0].sku, 'AASHATTA-10KG');
  assert.equal(rows[0].qty, 1500);
  assert.equal(rows[0].unit, 'bag');
});

test('regression: "fortune oil 5 litre 1,200 pcs" is one line, green as 1200 piece (was green as 1 piece)', async () => {
  const rows = await order('fortune oil 5 litre 1,200 pcs');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'ok', rows[0].reasons.join('; '));
  assert.equal(rows[0].sku, 'FORTOIL-5L');
  assert.equal(rows[0].qty, 1200);
  assert.equal(rows[0].unit, 'piece');
});

test('"maggi 2,500 pkt" reads 2500 packets, never the 500 left after a broken comma', async () => {
  const rows = await order('maggi 2,500 pkt');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'ok', rows[0].reasons.join('; '));
  assert.equal(rows[0].sku, 'MAGGI-70G');
  assert.equal(rows[0].qty, 2500);
  assert.equal(rows[0].unit, 'packet');
});

test('S16: "maggi 1,5 pkt" is amber with the unclear-number question and never quantity 5', async () => {
  const rows = await order('maggi 1,5 pkt');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'needs_review');
  assert.equal(rows[0].question, 'What does "1,5" mean?');
  assert.match(rows[0].reasons.join('; '), /number "1,5" is unclear/);
  assert.notEqual(rows[0].qty, 5);
  assert.notEqual(rows[0].qty, 1);
});

test('Indian grouping "maggi 1,00,000 pcs" reads 100000 and S11 sends it to review', async () => {
  assert.equal(parse('maggi 1,00,000 pcs').qty, 100000);
  const rows = await order('maggi 1,00,000 pcs');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'needs_review');
  assert.match(rows[0].reasons.join('; '), /implausible quantity 100000/);
});

test('well-formed Western and Indian groupings become one plain number', () => {
  assert.equal(normalize('maggi 1,000 pcs'), 'maggi 1000 pcs');
  assert.equal(normalize('12,500 pkt'), '12500 pkt');
  assert.equal(normalize('1,250,000 pcs'), '1250000 pcs');
  assert.equal(normalize('1,00,000 pcs'), '100000 pcs');
  assert.equal(normalize('12,34,567 pcs'), '1234567 pcs');
  assert.equal(normalize('rs.1,000'), 'rs 1000');
  for (const text of ['maggi 1,000 pcs', '1,250,000 pcs', '12,34,567 pcs']) assert.equal(parse(text).unclearNumber, null, text);
});

test('prices with grouping commas read as one price: "rs 1,000", "1,000/-", "₹1,000"', () => {
  for (const text of ['ghee rs 1,000 2 pkt', 'ghee 1,000/- 2 pkt', 'ghee ₹1,000 2 pkt']) {
    const p = parse(text);
    assert.equal(p.priceHint, 1000, text);
    assert.deepEqual(p.priceHints, [1000], text);
    assert.equal(p.qty, 2, text);
    assert.equal(p.unclearNumber, null, text);
  }
});

test('any other digit-comma-digit is never a quantity, price or size and leaves the product text', () => {
  const cases: [string, string][] = [
    ['maggi 1,5 pkt', '1,5'],
    ['maggi 2,50 pkt', '2,50'],
    ['maggi 1,0000 pcs', '1,0000'],
    ['maggi 1,000,5 pcs', '1,000,5'],
    ['maggi 12,3456 pcs', '12,3456'],
    ['maggi 1,000.5 pcs', '1,000.5'],
    ['maggi rs 2,50 3 pkt', '2,50'],
    ['maggi 2,50 rs 3 pkt', '2,50'],
    ['tata namak 1,5 kg 3 pkt', '1,5'],
  ];
  for (const [text, unclear] of cases) {
    const p: Parsed = parse(text);
    assert.equal(p.unclearNumber, unclear, text);
    assert.equal(p.productText, text.startsWith('tata') ? 'tata namak' : 'maggi', text);
    assert.equal(p.priceHint, null, text);
    assert.deepEqual(p.priceHints, [], text);
    assert.equal(p.sizeHint, null, text);
    assert.deepEqual(p.sizeHints, [], text);
    const pieces = unclear.split(/[,.]/).map(Number);
    for (const q of [p.qty, ...p.pairs.map((pair) => pair.qty)]) assert.ok(!pieces.includes(q as number), `${text}: quantity ${q} came from "${unclear}"`);
  }
  assert.equal(parse('maggi 1,5 pkt').qty, null);
  assert.equal(parse('maggi rs 2,50 3 pkt').qty, 3);
});

test('a comma between digits never splits an item; every other comma still does', () => {
  assert.deepEqual(splitOrder('maggi 2 ctn,parle g 5/- 1 petti'), ['maggi 2 ctn', 'parle g 5/- 1 petti']);
  assert.deepEqual(splitOrder('maggi 2 ctn, parle g 5/- 1 petti'), ['maggi 2 ctn', 'parle g 5/- 1 petti']);
  assert.deepEqual(splitOrder('aashirvaad atta 10 kg 1,500 bag, maggi 1,5 pkt; lux 1,00,000 pcs'), [
    'aashirvaad atta 10 kg 1,500 bag', 'maggi 1,5 pkt', 'lux 1,00,000 pcs',
  ]);
  assert.deepEqual(splitOrder('maggi 2,parle g 1 petti'), ['maggi 2', 'parle g 1 petti']);
});

test('Devanagari digits with a grouping comma stay one item and read as one number', async () => {
  const rows = await order('aashirvaad atta 10 kg १,५०० bag');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'ok', rows[0].reasons.join('; '));
  assert.deepEqual([rows[0].sku, rows[0].qty, rows[0].unit], ['AASHATTA-10KG', 1500, 'bag']);
});

test('property: parse() is unchanged for every dev and fixture line without a digit-comma-digit', () => {
  type Before = { file: string; id: string; text: string; plain: Parsed; named: Parsed };
  const before = readJsonl<Before>(here('./evidence/parse-before-a1.jsonl'));
  const phrases = new Map([
    ['data/synthetic/dev.jsonl', numberNamePhrases(loadCatalog(here('../data/synthetic/catalog.csv')))],
    ['data/fixture/test.jsonl', numberNamePhrases(loadCatalog(here('../data/fixture/catalog.csv')))],
  ]);
  const current = new Map<string, string>();
  for (const file of phrases.keys()) for (const c of readJsonl<{ id: string; text: string }>(here(`../${file}`))) current.set(`${file}#${c.id}`, c.text);
  assert.equal(before.length, current.size, 'the snapshot must cover every dev and fixture line');
  let checked = 0;
  for (const b of before) {
    assert.equal(current.get(`${b.file}#${b.id}`), b.text, `${b.file} ${b.id} text changed since the snapshot`);
    if (/\d,\d/.test(b.text)) continue;
    assert.deepEqual(parse(b.text), { ...b.plain, unclearNumber: null }, b.text);
    assert.deepEqual(parse(b.text, { namePhrases: phrases.get(b.file) }), { ...b.named, unclearNumber: null }, b.text);
    checked++;
  }
  assert.ok(checked >= 350, `checked ${checked} lines`);
});

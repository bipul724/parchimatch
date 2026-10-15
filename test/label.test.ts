// Purpose: the labelling helper for a human-written test set (A4), driven through piped stdin like a terminal session.
// Gold labels must be well-formed, progress must survive stopping, and nothing may be written into data/synthetic/.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bySku, loadCatalog } from '../src/catalog.ts';
import { splitOrder } from '../src/orderlines.ts';
import { UNITS } from '../src/types.ts';
import type { Case } from '../src/types.ts';
import { readJsonl } from '../src/util.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogPath = join(root, 'data/fixture/catalog.csv');
const index = bySku(loadCatalog(catalogPath));
const RAW = 'parle g 5/- 2 petti\n\nlays 10 wala 2 ctn\nपारले जी 5 वाला 2 पेटी\nmaggi masala 3 pkt\n';

function scratch(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'parchimatch-label-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function label(args: string[], answers: string[]) {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'src/label.ts'), ...args], {
    cwd: root, encoding: 'utf8', timeout: 10_000, input: answers.map((a) => `${a}\n`).join(''),
  });
  assert.ifError(r.error);
  assert.equal(r.signal, null, r.stdout + r.stderr);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function wellFormed(c: Case) {
  assert.match(c.id, /^h\d{3,}(-\d+)?$/); // h007, or h007-2 for the 2nd item of a line
  assert.equal(typeof c.text, 'string');
  assert.deepEqual(Object.keys(c.gold).sort(), ['qty', 'sku', 'status', 'unit']);
  assert.ok(c.gold.sku === null || index.has(c.gold.sku), `unknown sku ${c.gold.sku}`);
  assert.ok(c.gold.qty === null || (Number.isInteger(c.gold.qty) && c.gold.qty > 0), `bad qty ${c.gold.qty}`);
  assert.ok(c.gold.unit === null || (UNITS as readonly string[]).includes(c.gold.unit), `bad unit ${c.gold.unit}`);
  assert.ok(c.gold.status === 'ok' || c.gold.status === 'needs_review');
  if (c.gold.status === 'ok') assert.ok(c.gold.sku && c.gold.qty && c.gold.unit, `${c.id}: ok needs product, quantity and unit`);
  assert.ok(Array.isArray(c.tags) && c.tags.every((tag) => typeof tag === 'string' && tag.trim() === tag && tag !== ''));
}

test('labels piped answers into well-formed JSONL, re-asks invalid answers, and resumes where it stopped', (t) => {
  const dir = scratch(t);
  const raw = join(dir, 'raw.txt');
  const out = join(dir, 'human.jsonl');
  writeFileSync(raw, RAW);
  const args = ['--catalog', catalogPath, '--in', raw, '--out', out];

  const first = label(args, [
    '6', '', '', 'y', 'price_variant, hinglish_unit', // h001: Parle-G ₹5 is 6th (names sorted, numbers by value: ₹5 before ₹10); parsed qty/unit; y typed
    '9', 'n', 'abc', '2', 'jodi', 'ctn', 'ambiguous_variant', // h003: invalid answers are asked again (only 8 listed); n = needs review
    'prlg-5', '-', '', 'devanagari', // h004: product typed as a SKU, quantity unclear
    '4', // h005: stopped half-way (end of input), so nothing is saved for it
  ]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /PRLG-5/);
  assert.match(first.stdout, /parsed: qty 2 · unit carton/);
  assert.match(first.stdout, /Stopped\. 3 items labelled, 0 skipped, 1 to go/);
  const cases = readJsonl<Case>(out);
  for (const c of cases) wellFormed(c);
  assert.deepEqual(cases, [
    { id: 'h001', text: 'parle g 5/- 2 petti', gold: { sku: 'PRLG-5', qty: 2, unit: 'carton', status: 'ok' }, tags: ['price_variant', 'hinglish_unit'] },
    { id: 'h003', text: 'lays 10 wala 2 ctn', gold: { sku: null, qty: 2, unit: 'carton', status: 'needs_review' }, tags: ['ambiguous_variant'] },
    { id: 'h004', text: 'पारले जी 5 वाला 2 पेटी', gold: { sku: 'PRLG-5', qty: null, unit: 'carton', status: 'needs_review' }, tags: ['devanagari'] },
  ]);
  assert.match(readFileSync(out, 'utf8'), /^\/\/ /, 'a new file starts with a provenance comment');

  const second = label(args, ['4', '', '', 'n', '']);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.doesNotMatch(second.stdout, /parle g 5\/- 2 petti/, 'labelled lines are skipped, not asked again');
  assert.match(second.stdout, /Done\. 4 items labelled, 0 skipped \(4 items\)/);
  const all = readJsonl<Case>(out);
  for (const c of all) wellFormed(c);
  assert.deepEqual(all.slice(0, 3), cases);
  assert.deepEqual(all[3], { id: 'h005', text: 'maggi masala 3 pkt', gold: { sku: 'MAGGI-14', qty: 3, unit: 'packet', status: 'needs_review' }, tags: [] });
});

// The candidate block printed for one order line: [position, sku, label].
function shown(stdout: string, id: string): [number, string, string][] {
  const block = stdout.slice(stdout.indexOf(`] ${id} `)).split('\nProduct')[0];
  return [...block.matchAll(/^ {2}(\d+)\) (\S+) {2}(.+)$/gm)].map((m) => [Number(m[1]), m[2], m[3]]);
}

test('shows 8 candidates in alphabetical label order without scores, and a number picks the one shown there', (t) => {
  const dir = scratch(t);
  const raw = join(dir, 'raw.txt');
  const out = join(dir, 'human.jsonl');
  writeFileSync(raw, 'maggi masala 3 pkt\n');
  const r = label(['--catalog', catalogPath, '--in', raw, '--out', out], ['4', '', '', 'y', '']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const list = shown(r.stdout, 'h001');
  assert.deepEqual(list.map(([n]) => n), [1, 2, 3, 4, 5, 6, 7, 8]);
  const labels = list.map(([, , text]) => text);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })));
  assert.doesNotMatch(r.stdout, /\(-?\d+\.\d+\)/, 'no fuzzy scores');
  // Fuzzy ranks Maggi 70 g first; alphabetically it is 4th, and 4 saves exactly what was shown at 4.
  assert.equal(list[3][1], 'MAGGI-14');
  assert.equal(readJsonl<Case>(out)[0].gold.sku, list[3][1]);
});

test('the status question has no default: Enter and other answers ask again, and a bare Enter never labels ok', (t) => {
  const dir = scratch(t);
  const raw = join(dir, 'raw.txt');
  const out = join(dir, 'human.jsonl');
  writeFileSync(raw, 'parle g 5/- 2 petti\n');
  const args = ['--catalog', catalogPath, '--in', raw, '--out', out];
  const stray = label(args, ['6', '', '', '']);
  assert.equal(stray.status, 0, stray.stdout + stray.stderr);
  assert.match(stray.stdout, /\[y\/n\]: /);
  assert.doesNotMatch(stray.stdout, /\[Y\/n\]/);
  assert.equal(readJsonl<Case>(out).length, 0, 'Enter alone saved nothing');
  const r = label(args, ['6', '', '', '', 'maybe', 'y', '']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.split('Could a careful person enter this line without asking anything? [y/n]: ').length - 1, 3);
  assert.deepEqual(readJsonl<Case>(out)[0].gold, { sku: 'PRLG-5', qty: 2, unit: 'carton', status: 'ok' });
});

test('numbers in labels sort by value, so price variants read ₹5, ₹10, ₹20, ₹50', (t) => {
  const dir = scratch(t);
  const raw = join(dir, 'raw.txt');
  writeFileSync(raw, 'parle g 5/- 2 petti\n');
  const r = label(['--catalog', catalogPath, '--in', raw, '--out', join(dir, 'human.jsonl')], []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const parle = shown(r.stdout, 'h001').map(([, sku]) => sku).filter((sku) => sku.startsWith('PRLG-'));
  assert.deepEqual(parle, [...parle].sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))));
});

test('never writes into data/synthetic/, a locked file, or the input itself', (t) => {
  const dir = scratch(t);
  const raw = join(dir, 'raw.txt');
  writeFileSync(raw, RAW);
  const synthetic = join(root, 'data/synthetic');
  const before = readdirSync(synthetic).sort();
  for (const out of [join(synthetic, 'human.jsonl'), join(root, 'data/synthetic/../synthetic/human.jsonl'), 'data/synthetic/human.jsonl']) {
    const r = label(['--catalog', catalogPath, '--in', raw, '--out', out], ['1', '', '', '', '']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /won't write into data\/synthetic\//);
  }
  assert.deepEqual(readdirSync(synthetic).sort(), before);

  const locked = join(dir, 'locked.jsonl');
  writeFileSync(`${locked}.lock.json`, '{}');
  let r = label(['--catalog', catalogPath, '--in', raw, '--out', locked], ['1', '', '', '', '']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /is locked/);
  assert.equal(existsSync(locked), false);

  r = label(['--catalog', catalogPath, '--in', raw, '--out', raw], ['1']);
  assert.notEqual(r.status, 0);
  assert.equal(readFileSync(raw, 'utf8'), RAW);
});

test('stops when an already-labelled id no longer matches the input line, and needs all three flags', (t) => {
  const dir = scratch(t);
  const raw = join(dir, 'raw.txt');
  const out = join(dir, 'human.jsonl');
  writeFileSync(raw, RAW);
  writeFileSync(out, '{"id":"h001","text":"something else","gold":{"sku":null,"qty":null,"unit":null,"status":"needs_review"},"tags":[]}\n');
  const r = label(['--catalog', catalogPath, '--in', raw, '--out', out], ['1', '', '', '', '']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /h001 .*doesn't match line 1/);
  assert.equal(readJsonl<Case>(out).length, 1);

  const missing = label(['--catalog', catalogPath, '--in', raw], []);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--out/);
});

test('a missing or unreadable --in file stops with one plain line and writes nothing', (t) => {
  const dir = scratch(t);
  const out = join(dir, 'human.jsonl');
  const missing = join(dir, 'raw.txt');
  let r = label(['--catalog', catalogPath, '--in', missing, '--out', out], []);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stderr.trim(), `Can't read ${missing}: no such file. Save the order lines there first, one per line.`);
  assert.doesNotMatch(r.stdout + r.stderr, /\n\s+at |Error:|ENOENT/);
  assert.equal(existsSync(out), false);
  r = label(['--catalog', catalogPath, '--in', dir, '--out', out], []);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stderr.trim(), `Can't read ${dir}: it's a folder, not a file.`);
  assert.equal(existsSync(out), false);
});

// A14: the labeller cuts each input line into items with the app's own splitOrder(), so the human test set is
// labelled on exactly the pieces the app matches. Non-items (greetings, thanks) can be skipped.
test('a comma line becomes separate items h001-1/-2, numbering is stripped like the app, and s skips a greeting', (t) => {
  const dir = scratch(t);
  const raw = join(dir, 'raw.txt');
  const out = join(dir, 'human.jsonl');
  writeFileSync(raw, 'parle g 2 petti, maggi 1 ctn\n1) tata namak 1kg 5 ctn\nHi bhaiya\n');
  const args = ['--catalog', catalogPath, '--in', raw, '--out', out];
  const r = label(args, [
    'PRLG-5', '', '', 'n', 'ambiguous_variant', // h001-1: no price written, so a careful person would ask
    'MAGGI-14', '', '', 'y', '', // h001-2
    'TATASALT-1', '', '', 'y', '', // h002: "1) " stripped
    's', // h003: a greeting, not an order item
  ]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /h001-1 {2}parle g 2 petti\n {2}line 1, item 1 of 2: parle g 2 petti, maggi 1 ctn/);
  assert.match(r.stdout, /h001-2 {2}maggi 1 ctn\n {2}line 1, item 2 of 2: parle g 2 petti, maggi 1 ctn/);
  assert.match(r.stdout, /Product \[number, a SKU, n = needs review \/ not stocked, s = skip: not an order item\]: /);
  assert.match(r.stdout, /Done\. 3 items labelled, 1 skipped \(4 items\)/);
  const cases = readJsonl<Case>(out);
  for (const c of cases) wellFormed(c);
  assert.deepEqual(cases.map((c) => [c.id, c.text, c.gold.sku, c.gold.qty, c.gold.unit, c.gold.status]), [
    ['h001-1', 'parle g 2 petti', 'PRLG-5', 2, 'carton', 'needs_review'],
    ['h001-2', 'maggi 1 ctn', 'MAGGI-14', 1, 'carton', 'ok'],
    ['h002', 'tata namak 1kg 5 ctn', 'TATASALT-1', 5, 'carton', 'ok'],
  ]);
  assert.equal(readFileSync(`${out}.skipped`, 'utf8'), 'h003\tHi bhaiya\n');
  assert.ok(!readFileSync(out, 'utf8').includes('Hi bhaiya'), 'skipped items never enter the labelled JSONL');

  const again = label(args, []);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.doesNotMatch(again.stdout, /Product \[/, 'labelled and skipped items are not asked again');
  assert.match(again.stdout, /Done\. 3 items labelled, 1 skipped \(4 items\)/);
  assert.equal(readFileSync(`${out}.skipped`, 'utf8'), 'h003\tHi bhaiya\n');
});

test('the summary counts labelled and skipped items when stopping part-way', (t) => {
  const dir = scratch(t);
  const raw = join(dir, 'raw.txt');
  const out = join(dir, 'human.jsonl');
  writeFileSync(raw, 'namaste\nparle g 5/- 2 petti; maggi 1 ctn\nthank you\n');
  const r = label(['--catalog', catalogPath, '--in', raw, '--out', out], ['s', 'PRLG-5', '', '', 'y', '']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /4 items from 3 lines: 0 labelled, 0 skipped, 4 to go\./);
  assert.match(r.stdout, /Stopped\. 1 item labelled, 1 skipped, 2 to go/);
});

test('a changed input is caught per item, for labelled and for skipped items', (t) => {
  const dir = scratch(t);
  const raw = join(dir, 'raw.txt');
  const out = join(dir, 'human.jsonl');
  writeFileSync(raw, 'parle g 2 petti, maggi 1 ctn\nHi bhaiya\n');
  writeFileSync(out, '{"id":"h001-2","text":"maggi 9 ctn","gold":{"sku":null,"qty":null,"unit":null,"status":"needs_review"},"tags":[]}\n');
  let r = label(['--catalog', catalogPath, '--in', raw, '--out', out], ['n', '', '', '']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /h001-2 in .* is "maggi 9 ctn", but it doesn't match line 1, item 2 of 2 in .*raw\.txt \("maggi 1 ctn"\)/);
  writeFileSync(out, '');
  writeFileSync(`${out}.skipped`, 'h002\tHello bhaiya\n');
  r = label(['--catalog', catalogPath, '--in', raw, '--out', out], ['n', '', '', '']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /h002 in .*\.skipped is "Hello bhaiya", but it doesn't match line 2 in .*raw\.txt \("Hi bhaiya"\)/);
});

test('the items the labeller shows are exactly splitOrder() of the same text', (t) => {
  const dir = scratch(t);
  const raw = join(dir, 'raw.txt');
  const out = join(dir, 'human.jsonl');
  const sample = [
    'Namaste bhaiya',
    'parle g 5/- 2 petti, maggi 1 ctn; lux 10 rs 2 dozen',
    '- surf 1 kg 6 pkt',
    '2) aashirvaad atta 10 kg 1,500 bag',
    '* kitkat 20 rs 4 pcs,,',
    '',
    'maggi, 4 pack 1 ctn',
    '   ',
    'tata namak 1 kg 5 ctn',
  ].join('\n');
  writeFileSync(raw, sample);
  const expected = splitOrder(sample);
  // Skipping every item writes each one, in order, to the .skipped file: that is what was shown.
  const r = label(['--catalog', catalogPath, '--in', raw, '--out', out], expected.map(() => 's'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const shownItems = readFileSync(`${out}.skipped`, 'utf8').trim().split('\n').map((l) => l.split('\t').slice(1).join('\t'));
  assert.deepEqual(shownItems, expected);
  assert.ok(expected.includes('aashirvaad atta 10 kg 1,500 bag'), 'a digit comma stays inside its item');
  assert.match(r.stdout, new RegExp(`Done\\. 0 items labelled, ${expected.length} skipped \\(${expected.length} items\\)`));
});

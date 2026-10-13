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
  assert.match(c.id, /^h\d{3,}$/);
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
    '1', '', '', '', 'price_variant, hinglish_unit', // h001: top candidate, parsed qty/unit, careful person could enter it
    '9', 'n', 'abc', '2', 'jodi', 'ctn', 'ambiguous_variant', // h003: invalid answers are asked again; n = needs review
    'prlg-5', '-', '', 'devanagari', // h004: product typed as a SKU, quantity unclear
    '1', // h005: stopped half-way (end of input), so nothing is saved for it
  ]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /PRLG-5/);
  assert.match(first.stdout, /parsed: qty 2 · unit carton/);
  assert.match(first.stdout, /Stopped\. 3 lines labelled/);
  const cases = readJsonl<Case>(out);
  for (const c of cases) wellFormed(c);
  assert.deepEqual(cases, [
    { id: 'h001', text: 'parle g 5/- 2 petti', gold: { sku: 'PRLG-5', qty: 2, unit: 'carton', status: 'ok' }, tags: ['price_variant', 'hinglish_unit'] },
    { id: 'h003', text: 'lays 10 wala 2 ctn', gold: { sku: null, qty: 2, unit: 'carton', status: 'needs_review' }, tags: ['ambiguous_variant'] },
    { id: 'h004', text: 'पारले जी 5 वाला 2 पेटी', gold: { sku: 'PRLG-5', qty: null, unit: 'carton', status: 'needs_review' }, tags: ['devanagari'] },
  ]);
  assert.match(readFileSync(out, 'utf8'), /^\/\/ /, 'a new file starts with a provenance comment');

  const second = label(args, ['1', '', '', 'n', '']);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.doesNotMatch(second.stdout, /parle g 5\/- 2 petti/, 'labelled lines are skipped, not asked again');
  assert.match(second.stdout, /Done\. 4 of 4 lines labelled/);
  const all = readJsonl<Case>(out);
  for (const c of all) wellFormed(c);
  assert.deepEqual(all.slice(0, 3), cases);
  assert.deepEqual(all[3], { id: 'h005', text: 'maggi masala 3 pkt', gold: { sku: 'MAGGI-14', qty: 3, unit: 'packet', status: 'needs_review' }, tags: [] });
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

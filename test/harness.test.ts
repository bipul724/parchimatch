// Exercise held-out-set locks, leak refusals, and seeded generation using only temporary files.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findLeaks } from '../src/checkleak.ts';
import type { Case } from '../src/types.ts';
import { sha256, writeJsonl } from '../src/util.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureCatalog = join(root, 'data/fixture/catalog.csv');
const heldOut = 'tata tea premium 250 gm 2 ctn';
const nearCopy = 'tata tea premium 250 gm 2 ctns';

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'parchimatch-harness-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(file: string, args: string[]) {
  const result = spawnSync(process.execPath, [...process.execArgv.filter((arg) => !arg.startsWith('--test')), join(root, file), ...args], {
    // A SENTRY_DSN in the developer's shell would switch eval tracing on (A12); these runs stay untraced.
    cwd: root, encoding: 'utf8', timeout: 20_000, env: { ...process.env, SENTRY_DSN: '' },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return { status: result.status, output: result.stdout + result.stderr };
}

function line(id: string, text: string): Case {
  return { id, text, gold: { sku: 'TATATEA-250', qty: 2, unit: 'carton', status: 'ok' }, tags: ['harness_fixture'] };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  }).sort();
}

test('split refuses to re-split a locked set and preserves test/dev/lock bytes', (t) => {
  const dir = scratch(t);
  const input = join(dir, 'labelled.jsonl');
  const out = join(dir, 'split');
  writeJsonl(input, Array.from({ length: 8 }, (_, i) => line(`f${i}`, `tata tea premium 250 gm ${i + 1} ctn`)));
  const args = ['--in', input, '--out', out, '--test', '2', '--seed', '7'];
  assert.equal(run('src/split.ts', args).status, 0);
  const paths = ['test.jsonl', 'dev.jsonl', 'test.jsonl.lock.json'].map((name) => join(out, name));
  const before = paths.map((path) => readFileSync(path, 'utf8'));
  const again = run('src/split.ts', [...args, '--seed', '99']);
  assert.equal(again.status, 1);
  assert.match(again.output, /already locked/);
  assert.deepEqual(paths.map((path) => readFileSync(path, 'utf8')), before);
});

test('eval refuses a test file changed after locking before writing any results', (t) => {
  const dir = scratch(t);
  const cases = join(dir, 'test.jsonl');
  const out = join(dir, 'results');
  writeJsonl(cases, [line('held-out', heldOut)]);
  writeFileSync(`${cases}.lock.json`, JSON.stringify({ sha256: sha256(readFileSync(cases, 'utf8')) }));
  writeJsonl(cases, [line('held-out', nearCopy)]);
  const result = run('src/eval.ts', ['--catalog', fixtureCatalog, '--cases', cases, '--methods', 'exact,fuzzy', '--out', out]);
  assert.equal(result.status, 1);
  assert.match(result.output, /changed after it was locked/);
  assert.equal(existsSync(out), false);
});

test('checkleak catches a non-identical near-duplicate and ignores unrelated text', () => {
  const leaks = findLeaks([heldOut], [nearCopy, 'lux 10 rs 5 dozen'], 0.85);
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].candidate, nearCopy);
  assert.equal(leaks[0].test, heldOut);
  assert.ok(leaks[0].similarity >= 0.85 && leaks[0].similarity < 1);
  assert.equal(findLeaks([heldOut], [heldOut.toUpperCase()], 0.85)[0].similarity, 1);
});

test('checkleak CLI exits unsuccessfully on a near-duplicate', (t) => {
  const dir = scratch(t);
  const locked = join(dir, 'test.jsonl');
  const candidate = join(dir, 'candidate.jsonl');
  writeJsonl(locked, [line('held-out', heldOut)]);
  writeJsonl(candidate, [line('train', nearCopy)]);
  const result = run('src/checkleak.ts', ['--test', locked, '--candidate', candidate]);
  assert.equal(result.status, 1);
  assert.match(result.output, /near-duplicates of test lines/);
  assert.match(result.output, /tata tea premium 250 gm 2 ctns/);
});

test('exporttrain refuses a near-duplicate without creating or overwriting output', (t) => {
  const dir = scratch(t);
  const locked = join(dir, 'test.jsonl');
  const candidate = join(dir, 'candidate.jsonl');
  writeJsonl(locked, [line('held-out', heldOut)]);
  writeJsonl(candidate, [line('train', nearCopy)]);
  for (const existing of [false, true]) {
    const out = join(dir, existing ? 'existing-chat.jsonl' : 'new-chat.jsonl');
    if (existing) writeFileSync(out, 'previous training export\n');
    const result = run('src/exporttrain.ts', ['--catalog', fixtureCatalog, '--in', candidate, '--test', locked, '--out', out]);
    assert.equal(result.status, 1);
    assert.match(result.output, /training lines are near-duplicates/);
    if (existing) assert.equal(readFileSync(out, 'utf8'), 'previous training export\n');
    else assert.equal(existsSync(out), false);
  }
});

test('generator same seed produces identical payload files and hashes in temporary directories', (t) => {
  const dir = scratch(t);
  const dirs = [join(dir, 'first'), join(dir, 'second')];
  for (const out of dirs) {
    const result = run('tools/gen-synthetic.ts', ['--out', out, '--test', '8', '--dev', '20', '--seed', '4271']);
    assert.equal(result.status, 0, result.output);
  }
  const paths = dirs.map((out) => filesUnder(out).map((path) => relative(out, path)));
  assert.deepEqual(paths[0], paths[1]);
  for (const path of paths[0]) {
    const contents = dirs.map((out) => readFileSync(join(out, path), 'utf8'));
    if (path.endsWith('.lock.json')) {
      const [{ created: firstCreated, ...first }, { created: secondCreated, ...second }] = contents.map((text) => JSON.parse(text));
      // Creation time is provenance, not seeded data; compare every other lock field.
      assert.ok(Number.isFinite(Date.parse(firstCreated)) && Number.isFinite(Date.parse(secondCreated)));
      assert.deepEqual(first, second);
      for (const out of dirs) assert.equal(first.sha256, sha256(readFileSync(join(out, 'test.jsonl'), 'utf8')));
    } else {
      assert.equal(contents[0], contents[1], path);
      assert.equal(sha256(contents[0]), sha256(contents[1]), path);
    }
  }
  assert.equal(findLeaks(
    readFileSync(join(dirs[0], 'test.jsonl'), 'utf8').trim().split('\n').map((s) => JSON.parse(s).text),
    readFileSync(join(dirs[0], 'dev.jsonl'), 'utf8').trim().split('\n').map((s) => JSON.parse(s).text), 0.85,
  ).length, 0);
});

test('generator refuses locked regeneration and dev-only preserves held-out bytes', (t) => {
  const dir = scratch(t);
  const args = ['--out', dir, '--test', '5', '--dev', '8', '--seed', '4242'];
  assert.equal(run('tools/gen-synthetic.ts', args).status, 0);
  const paths = ['test.jsonl', 'test.jsonl.lock.json'].map((name) => join(dir, name));
  const before = paths.map((path) => readFileSync(path, 'utf8'));
  const refused = run('tools/gen-synthetic.ts', [...args, '--seed', '9']);
  assert.equal(refused.status, 1);
  assert.match(refused.output, /test set is locked/);
  assert.deepEqual(paths.map((path) => readFileSync(path, 'utf8')), before);
  const practice = run('tools/gen-synthetic.ts', [...args, '--seed', '9', '--dev-only']);
  assert.equal(practice.status, 0, practice.output);
  assert.deepEqual(paths.map((path) => readFileSync(path, 'utf8')), before);
});

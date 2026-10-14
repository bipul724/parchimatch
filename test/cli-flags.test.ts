// Purpose: a flag written without a value used to become the text "true" ("--catalog" → file "true") and crash
// with a confusing error (A8). Server and eval must stop at once with one clear line and a non-zero exit code.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'parchimatch-flags-'));
after(() => rmSync(temp, { recursive: true, force: true }));

// Nothing here may reach a real Ollama or write into the project: a closed local port and a temp data folder.
function run(file: string, args: string[]) {
  const base = file === 'src/server.ts' ? ['--data', join(temp, 'data'), '--url', 'http://127.0.0.1:9'] : ['--out', join(temp, 'out'), '--url', 'http://127.0.0.1:9'];
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, file), ...base, ...args], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${file} ${args.join(' ')} did not exit by itself: ${result.stdout}${result.stderr}`);
  return { status: result.status, stderr: result.stderr, output: result.stdout + result.stderr };
}

const fails = (r: ReturnType<typeof run>, message: string) => {
  assert.notEqual(r.status, 0, r.output);
  assert.equal(r.stderr.trim(), message, r.output);
  assert.doesNotMatch(r.output, /\n\s+at |Error:|ENOENT/, 'no stack trace or file error');
};

test('server: --catalog without a value exits with a clear message', () => {
  fails(run('src/server.ts', ['--catalog']), '--catalog needs a value, e.g. --catalog data/real/catalog.csv');
  fails(run('src/server.ts', ['--catalog', '--port', '0']), '--catalog needs a value, e.g. --catalog data/real/catalog.csv');
  fails(run('src/server.ts', ['--catalog', '']), '--catalog needs a value, e.g. --catalog data/real/catalog.csv');
});

test('server: every path and text flag without a value is named in the message', () => {
  fails(run('src/server.ts', ['--samples']), '--samples needs a value, e.g. --samples data/synthetic/orders');
  fails(run('src/server.ts', ['--model']), '--model needs a value, e.g. --model gemma4:e2b-it-qat');
  fails(run('src/server.ts', ['--port']), '--port needs a value, e.g. --port 5178');
  // The base arguments pass --data and --url first; a later valueless copy of the flag wins, as with any repeated flag.
  fails(run('src/server.ts', ['--data']), '--data needs a value, e.g. --data data/app');
  fails(run('src/server.ts', ['--url']), '--url needs a value, e.g. --url http://127.0.0.1:11434');
});

test('server: --port must be a whole number from 0 to 65535', () => {
  for (const port of ['abc', '1.5', '-1', '65536', '80x']) {
    fails(run('src/server.ts', ['--port', port]), '--port must be a whole number from 0 to 65535, e.g. --port 5178');
  }
});

test('eval: path and text flags without a value exit with a clear message', () => {
  fails(run('src/eval.ts', ['--cases']), '--cases needs a value, e.g. --cases data/synthetic/dev.jsonl');
  fails(run('src/eval.ts', ['--catalog', '--cases', 'data/fixture/test.jsonl']), '--catalog needs a value, e.g. --catalog data/real/catalog.csv');
  fails(run('src/eval.ts', ['--label']), '--label needs a value, e.g. --label my-change');
  fails(run('src/eval.ts', ['--model']), '--model needs a value, e.g. --model gemma4:e2b-it-qat');
  fails(run('src/eval.ts', ['--out']), '--out needs a value, e.g. --out results');
  fails(run('src/eval.ts', ['--url']), '--url needs a value, e.g. --url http://127.0.0.1:11434');
});

test('eval: numeric flags without a value or with an invalid value stop before any evaluation starts', () => {
  // Before A9, a valueless --limit scored 1 case and a valueless --min-score became 1 (fuzzy accepted nothing), silently.
  const fixture = ['--catalog', 'data/fixture/catalog.csv', '--cases', 'data/fixture/test.jsonl', '--methods', 'exact'];
  const cases: [string[], string][] = [
    [['--limit'], '--limit needs a value, e.g. --limit 20'],
    [['--k', '0'], '--k must be a whole number from 1 up, e.g. --k 8'],
    [['--min-score', '2'], '--min-score must be a number from 0 to 1, e.g. --min-score 0.5'],
    [['--methods'], '--methods needs a value, e.g. --methods exact,fuzzy'],
    [['--min-score'], '--min-score needs a value, e.g. --min-score 0.5'],
    [['--min-margin', '-0.1'], '--min-margin must be a number from 0 to 1, e.g. --min-margin 0.08'],
    [['--min-margin', '0x1'], '--min-margin must be a number from 0 to 1, e.g. --min-margin 0.08'],
    [['--ctx', '1.5'], '--ctx must be a whole number from 1 up, e.g. --ctx 2048'],
    [['--limit', 'all'], '--limit must be a whole number from 1 up, e.g. --limit 20'],
    [['--show', '-1'], '--show must be a whole number from 0 up, e.g. --show 12'],
    [['--show'], '--show needs a value, e.g. --show 12'],
  ];
  for (const [flags, message] of cases) {
    const r = run('src/eval.ts', [...fixture, ...flags]);
    assert.equal(r.status, 1, `${flags.join(' ')}: ${r.output}`);
    fails(r, message);
    assert.doesNotMatch(r.output, /Catalogue|cases/, `${flags.join(' ')} must not start an evaluation`);
    assert.equal(existsSync(join(temp, 'out')), false, `${flags.join(' ')} must not write results`);
  }
});

test('eval: valid numeric flags still run', () => {
  const r = run('src/eval.ts', ['--catalog', 'data/fixture/catalog.csv', '--cases', 'data/fixture/test.jsonl', '--methods', 'exact,fuzzy', '--limit', '5', '--k', '8', '--min-score', '0.5', '--min-margin', '0.08', '--ctx', '2048', '--show', '0', '--out', join(temp, 'valid-out')]);
  assert.equal(r.status, 0, r.output);
  assert.match(r.output, /cases test\.jsonl: 5 /);
});

test('server: an explicit --catalog that is missing or invalid stops with a plain message and never falls back', () => {
  let r = run('src/server.ts', ['--catalog', 'data/real/no-such-catalog.csv']);
  assert.equal(r.status, 1, r.output);
  fails(r, "Can't read catalogue data/real/no-such-catalog.csv: no such file.");
  assert.doesNotMatch(r.output, /catalogue \d+ items/, 'no fallback to another catalogue');
  const bad = join(temp, 'bad-catalog.csv');
  writeFileSync(bad, 'sku,name,brand,variant,mrp,sell_units,units_per_carton,aliases\nBAD1,Broken,X,1 pc,5,crate,,broken\n');
  r = run('src/server.ts', ['--catalog', bad]);
  assert.equal(r.status, 1, r.output);
  fails(r, `Catalogue ${bad} has problems:\n  row 2: unknown unit "crate"`);
  assert.doesNotMatch(r.output, /catalogue \d+ items/);
});

// Eval names result files by the second; a second run in that second used to overwrite the first one's rows.
const evalArgs = (out: string) => ['--disable-warning=ExperimentalWarning', join(root, 'src/eval.ts'), '--catalog', 'data/fixture/catalog.csv', '--cases', 'data/fixture/test.jsonl', '--methods', 'exact,fuzzy', '--show', '0', '--out', out];
const stampOf = (ms: number) => new Date(ms).toISOString().replace(/[:.]/g, '-').slice(0, 19);

test('eval: an existing results file is never overwritten; the new one gets -2', () => {
  const out = join(temp, 'results-existing');
  mkdirSync(out, { recursive: true });
  // Occupy every name this run could pick in the next 20 seconds, as an earlier run in the same second would.
  const now = Date.now();
  for (let s = -1; s < 20; s++) for (const m of ['exact', 'fuzzy']) writeFileSync(join(out, `${stampOf(now + s * 1000)}_${m}.json`), 'earlier run');
  const r = spawnSync(process.execPath, evalArgs(out), { cwd: root, encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const files = readdirSync(out).filter((f) => f.endsWith('.json'));
  for (const f of files.filter((f) => !/-2\.json$/.test(f))) assert.equal(readFileSync(join(out, f), 'utf8'), 'earlier run', `${f} was overwritten`);
  const kept = files.filter((f) => /_(exact|fuzzy)-2\.json$/.test(f));
  assert.equal(kept.length, 2, `new results saved as -2: ${files.join(', ')}`);
  for (const f of kept) assert.ok(JSON.parse(readFileSync(join(out, f), 'utf8')).rows, f);
});

test('eval: two runs started together into one --out folder keep all four per-row files and four summary rows', async () => {
  const out = join(temp, 'results-parallel');
  const procs = [0, 1].map(() => spawn(process.execPath, evalArgs(out), { cwd: root, stdio: 'ignore' }));
  const codes = await Promise.all(procs.map(async (p) => (await once(p, 'exit'))[0]));
  assert.deepEqual(codes, [0, 0]);
  const files = readdirSync(out).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 4, files.join(', '));
  assert.equal(readFileSync(join(out, 'summary.md'), 'utf8').split('\n').filter((l) => /\| (exact|fuzzy) \|/.test(l)).length, 4);
});

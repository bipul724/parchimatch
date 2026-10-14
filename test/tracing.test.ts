// Purpose: opt-in Sentry agent tracing for the evaluation harness (A12). Uses a fake tracer and the Ollama stub:
// nothing here needs @sentry/node or sends anything. The shop app (server, start) must never load tracing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog.ts';
import { evaluateMethod, summarise } from '../src/eval.ts';
import { makeCtx } from '../src/methods.ts';
import { SYSTEM_PROMPT } from '../src/prompt.ts';
import { makeTracer, noopTracer } from '../src/trace.ts';
import type { Case } from '../src/types.ts';
import { readJsonl } from '../src/util.ts';
import { fakeTracer } from './helpers/fake-tracer.ts';
import type { FakeSpan } from './helpers/fake-tracer.ts';
import { startOllamaStub } from './helpers/ollama-stub.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = loadCatalog(join(root, 'data/fixture/catalog.csv'));
const LAYS = { evidence: 'lays', sku: 'LAYS-CLS-10', status: 'ok' };
let stub: Awaited<ReturnType<typeof startOllamaStub>>;
let temp: string;

// Deterministic replies keyed by the order line, so tracing on and off see the same model answers.
const reply = (request: { body: { messages: { role: string; content: string }[] } }) => {
  const user = request.body.messages.find((m) => m.role === 'user')?.content ?? '';
  if (user.includes('lays 10 wala 2 ctn')) return { body: { message: { content: JSON.stringify(LAYS) }, prompt_eval_count: 321, eval_count: 17 } };
  if (user.includes('tata namak 5 petti')) return { status: 500, error: 'boom' };
  if (user.includes('fruti 2 petti')) return { content: 'not json' };
  return { content: { evidence: '', sku: '', status: 'needs_review' } };
};

before(async () => {
  stub = await startOllamaStub({ handler: reply });
  temp = mkdtempSync(join(tmpdir(), 'parchimatch-trace-'));
});
after(async () => { await stub?.close(); if (temp) rmSync(temp, { recursive: true, force: true }); });

const ctx = () => makeCtx(catalog, { llm: { url: stub.url, model: stub.model, think: false, numCtx: 2048 } });
const meta = { label: 'test-label', model: 'test-model', casesFile: 'cases.jsonl', casesSha: 'abc123def456' };
const line = (id: string, text: string, gold: Case['gold']): Case => ({ id, text, gold, tags: [] });
const json = (v: unknown) => JSON.parse(String(v));
const names = (s: FakeSpan) => s.children.map((c) => c.name);

test('hybrid span tree: root, one invoke_agent per line, fuzzy_match and safety_rules, and chat only when the model is called', async () => {
  stub.setHandler(reply);
  const { tracer, roots, all } = fakeTracer();
  const cases = [
    line('c1', 'parle g 5/- 2 petti', { sku: 'PRLG-5', qty: 2, unit: 'carton', status: 'ok' }),
    line('c2', 'lays 10 wala 2 ctn', { sku: null, qty: 2, unit: 'carton', status: 'needs_review' }),
  ];
  const rows = await evaluateMethod('hybrid', cases, ctx(), tracer, meta);
  assert.equal(rows.length, 2);

  assert.equal(roots.length, 1);
  const run = roots[0];
  assert.equal(run.name, 'eval hybrid test-label');
  assert.deepEqual(
    [run.attributes['parchimatch.method'], run.attributes['gen_ai.request.model'], run.attributes['parchimatch.cases'], run.attributes['parchimatch.cases_sha'], run.attributes['parchimatch.k'], run.attributes['parchimatch.min_score']],
    ['hybrid', 'test-model', 'cases.jsonl', 'abc123def456', 8, 0.5],
  );
  assert.deepEqual(names(run), ['invoke_agent parchimatch-hybrid', 'invoke_agent parchimatch-hybrid']);

  const [fuzzyLine, modelLine] = run.children;
  for (const [agent, c] of [[fuzzyLine, cases[0]], [modelLine, cases[1]]] as const) {
    assert.equal(agent.op, 'gen_ai.invoke_agent');
    assert.equal(agent.attributes['gen_ai.operation.name'], 'invoke_agent');
    assert.equal(agent.attributes['gen_ai.agent.name'], 'parchimatch-hybrid');
    assert.deepEqual(json(agent.attributes['gen_ai.input.messages']), [{ role: 'user', parts: [{ type: 'text', content: c.text }] }]);
    assert.equal(agent.attributes['parchimatch.case_id'], c.id);
  }

  // A line fuzzy matching names confidently: no model call.
  assert.deepEqual(names(fuzzyLine), ['execute_tool fuzzy_match', 'execute_tool safety_rules']);
  assert.equal(fuzzyLine.attributes['parchimatch.outcome'], 'auto_correct');
  assert.equal(fuzzyLine.attributes['parchimatch.status'], 'ok');
  assert.deepEqual(json(fuzzyLine.attributes['parchimatch.reasons']), []);
  assert.deepEqual(json(json(fuzzyLine.attributes['gen_ai.output.messages'])[0].parts[0].content), { sku: 'PRLG-5', qty: 2, unit: 'carton', status: 'ok', question: '' });
  const fuzzy = fuzzyLine.children[0];
  assert.equal(fuzzy.op, 'gen_ai.execute_tool');
  assert.equal(fuzzy.attributes['gen_ai.operation.name'], 'execute_tool');
  assert.equal(fuzzy.attributes['gen_ai.tool.name'], 'fuzzy_match');
  assert.equal(json(fuzzy.attributes['gen_ai.tool.call.result']).top_sku, 'PRLG-5');
  assert.equal(typeof fuzzy.attributes['parchimatch.top_score'], 'number');
  assert.ok(Number(fuzzy.attributes['parchimatch.lead']) >= 0.08);

  // A line fuzzy can't name: the model is asked, and its pick goes through the safety rules.
  assert.deepEqual(names(modelLine), ['execute_tool fuzzy_match', 'chat test-model', 'execute_tool safety_rules']);
  const chat = modelLine.children[1];
  assert.equal(chat.op, 'gen_ai.chat');
  assert.deepEqual(
    [chat.attributes['gen_ai.operation.name'], chat.attributes['gen_ai.provider.name'], chat.attributes['gen_ai.request.model'], chat.attributes['gen_ai.response.model'], chat.attributes['gen_ai.request.temperature']],
    ['chat', 'ollama', 'test-model', 'test-model', 0],
  );
  assert.deepEqual([chat.attributes['gen_ai.usage.input_tokens'], chat.attributes['gen_ai.usage.output_tokens']], [321, 17]);
  assert.equal(chat.attributes['gen_ai.system_instructions'], SYSTEM_PROMPT);
  const input = json(chat.attributes['gen_ai.input.messages']);
  assert.equal(input.length, 1);
  assert.equal(input[0].role, 'user');
  assert.equal(input[0].parts[0].type, 'text');
  assert.match(input[0].parts[0].content, /lays 10 wala 2 ctn/);
  assert.deepEqual(json(chat.attributes['gen_ai.output.messages']), [{ role: 'assistant', parts: [{ type: 'text', content: JSON.stringify(LAYS) }] }]);
  assert.equal(chat.status, null);
  const rules = modelLine.children[2];
  assert.equal(rules.attributes['gen_ai.tool.name'], 'safety_rules');
  assert.match(String(rules.attributes['parchimatch.reasons']), /about as well as/);
  assert.equal(modelLine.attributes['parchimatch.status'], 'needs_review');
  assert.equal(modelLine.attributes['parchimatch.outcome'], 'flagged_correctly');
  assert.deepEqual([modelLine.attributes['gen_ai.usage.input_tokens'], modelLine.attributes['gen_ai.usage.output_tokens']], [321, 17]);

  // Span attributes must be primitives; anything complex is a JSON string.
  for (const span of all) for (const [k, v] of Object.entries(span.attributes)) assert.ok(['string', 'number', 'boolean'].includes(typeof v), `${span.name} ${k} is ${typeof v}`);
});

test('a model failure marks the chat span as an error with a low-cardinality error.type', async () => {
  stub.setHandler(reply);
  const { tracer, roots } = fakeTracer();
  await evaluateMethod('hybrid', [
    line('e1', 'tata namak 5 petti', { sku: 'TATASALT-1', qty: 5, unit: 'carton', status: 'ok' }),
    line('e2', 'fruti 2 petti', { sku: 'FROOTI-10', qty: 2, unit: 'carton', status: 'ok' }),
  ], ctx(), tracer, meta);
  const chats = roots[0].children.map((agent) => agent.children.find((c) => c.op === 'gen_ai.chat'));
  assert.ok(chats[0] && chats[1], 'both lines called the model');
  assert.equal(chats[0]!.status?.code, 2);
  assert.equal(chats[0]!.attributes['error.type'], 'http_500');
  assert.equal(chats[1]!.status?.code, 2);
  assert.equal(chats[1]!.attributes['error.type'], 'invalid_json');
  for (const agent of roots[0].children) assert.equal(agent.attributes['parchimatch.status'], 'needs_review');
});

test('tracing changes no result: rows and summary numbers are identical with tracing on and off', async () => {
  stub.setHandler(reply);
  const cases = readJsonl<Case>(join(root, 'data/fixture/test.jsonl'));
  // Model latency differs between any two runs, so it is the one thing left out of the comparison.
  const timeless = (rows: Awaited<ReturnType<typeof evaluateMethod>>) => rows.map((r) => ({ ...r, result: { ...r.result, llm: r.result.llm && { ...r.result.llm, ms: 0 } } }));
  const numbers = (rows: Awaited<ReturnType<typeof evaluateMethod>>) => {
    const { p50ms, p95ms, ...rest } = summarise(rows);
    return rest;
  };
  for (const method of ['exact', 'fuzzy', 'hybrid'] as const) {
    const off = await evaluateMethod(method, cases, ctx(), noopTracer, meta);
    const fake = fakeTracer();
    const on = await evaluateMethod(method, cases, ctx(), fake.tracer, meta);
    assert.deepEqual(timeless(on), timeless(off), method);
    assert.deepEqual(numbers(on), numbers(off), method);
    assert.equal(fake.roots[0].children.length, cases.length, `${method}: one invoke_agent span per line`);
  }
});

test('makeTracer: without SENTRY_DSN nothing is imported and no span is recorded', async () => {
  const imported: string[] = [];
  const importer = async (name: string) => { imported.push(name); return {}; };
  for (const env of [{}, { SENTRY_DSN: '' }]) {
    const tracer = await makeTracer(env, { importer });
    assert.equal(tracer, noopTracer);
    assert.equal(tracer.startSpan({ name: 'x' }, () => 42), 42);
  }
  assert.deepEqual(imported, []);
  const { tracer, all } = fakeTracer();
  assert.equal(all.length, 0);
  assert.ok(tracer);
});

test('makeTracer: SENTRY_DSN set loads @sentry/node on demand, initialises it for eval, and flushes', async () => {
  const calls: unknown[][] = [];
  const sentry = {
    init: (options: unknown) => calls.push(['init', options]),
    startSpan: (options: unknown, fn: (span: unknown) => unknown) => { calls.push(['startSpan', options]); return fn({ setAttribute() {}, setAttributes() {}, setStatus() {} }); },
    flush: async (ms: number) => { calls.push(['flush', ms]); return true; },
  };
  const tracer = await makeTracer({ SENTRY_DSN: 'https://public@127.0.0.1:9/1' }, { release: 'abc1234', importer: async (name) => { assert.equal(name, '@sentry/node'); return sentry; } });
  assert.equal(tracer.startSpan({ name: 'chat m', op: 'gen_ai.chat', attributes: { a: 1, gone: undefined } }, () => 'done'), 'done');
  await tracer.flush();
  assert.deepEqual(calls, [
    ['init', { dsn: 'https://public@127.0.0.1:9/1', tracesSampleRate: 1.0, environment: 'eval', release: 'abc1234' }],
    ['startSpan', { name: 'chat m', op: 'gen_ai.chat', attributes: { a: 1 } }],
    ['flush', 5000],
  ]);
  const missing = Object.assign(new Error("Cannot find package '@sentry/node'"), { code: 'ERR_MODULE_NOT_FOUND' });
  await assert.rejects(makeTracer({ SENTRY_DSN: 'x' }, { importer: async () => { throw missing; } }), { message: 'Tracing needs @sentry/node: npm install --no-save @sentry/node' });
});

// Spawned eval runs. SENTRY_DSN points at a closed local port, so even an installed @sentry/node could send nothing.
const evalRun = (args: string[]) => {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'src/eval.ts'), '--methods', 'exact,fuzzy', '--show', '0', '--out', join(temp, 'out'), ...args], {
    cwd: root, encoding: 'utf8', timeout: 20_000, env: { ...process.env, SENTRY_DSN: 'https://public@127.0.0.1:9/1' },
  });
  assert.equal(r.signal, null);
  return r;
};

test('tracing is refused for cases or a catalogue outside data/synthetic/ and data/fixture/', () => {
  const outside = join(temp, 'cases.jsonl');
  copyFileSync(join(root, 'data/fixture/test.jsonl'), outside);
  let r = evalRun(['--catalog', 'data/fixture/catalog.csv', '--cases', outside]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stderr.trim(), `Tracing only runs on synthetic or fixture data (data/synthetic/, data/fixture/); --cases ${outside} is outside. Unset SENTRY_DSN to evaluate it without tracing.`);
  assert.equal(r.stdout, '');
  const catalogOutside = join(temp, 'catalog.csv');
  copyFileSync(join(root, 'data/fixture/catalog.csv'), catalogOutside);
  r = evalRun(['--catalog', catalogOutside, '--cases', 'data/fixture/test.jsonl']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--catalog .*catalog\.csv is outside/);
  r = evalRun(['--catalog', 'data/fixture/catalog.csv', '--cases', 'data/fixture/../../test/../data/fixture/test.jsonl']);
  assert.doesNotMatch(r.stderr, /is outside/, 'a path that resolves inside data/fixture/ is allowed');
});

test('tracing is refused for a locked test set, so a traced run never counts as another locked-test run', () => {
  const r = evalRun(['--catalog', 'data/synthetic/catalog.csv', '--cases', 'data/synthetic/test.jsonl']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stderr.trim(), 'Tracing is off for a locked test set (data/synthetic/test.jsonl.lock.json). Trace the practice set instead, e.g. --cases data/synthetic/dev.jsonl.');
  assert.equal(r.stdout, '', 'refused before anything was evaluated');
});

test('tracing without @sentry/node installed stops with the install command', (t) => {
  try {
    import.meta.resolve('@sentry/node');
    t.skip('@sentry/node is installed here');
    return;
  } catch {}
  const r = evalRun(['--catalog', 'data/fixture/catalog.csv', '--cases', 'data/fixture/test.jsonl']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stderr.trim(), 'Tracing needs @sentry/node: npm install --no-save @sentry/node');
  assert.equal(r.stdout, '');
});

test('the shop app never loads tracing: server.ts and start.ts, and every module they import at runtime', () => {
  for (const file of ['src/server.ts', 'src/start.ts']) {
    const source = readFileSync(join(root, file), 'utf8');
    assert.doesNotMatch(source, /sentry/i, file);
    assert.doesNotMatch(source, /trace\.ts/, file);
  }
  // Walk runtime imports (`import type` is erased by Node) from both entry points.
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /@sentry|import\(['"`]/, `${file} must not import Sentry or load modules dynamically`);
    for (const m of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'(\.[^']+)'/gm)) walk(resolve(dirname(file), m[1]));
  };
  walk(join(root, 'src/server.ts'));
  walk(join(root, 'src/start.ts'));
  assert.ok(!seen.has(join(root, 'src/trace.ts')), 'trace.ts is not reachable from the app');
  assert.ok(seen.has(join(root, 'src/methods.ts')), 'the walk follows the shared pipeline');
});

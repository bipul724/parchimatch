// Purpose: exercise the real HTTP server, persistence, hostile model replies, and isolated failure paths.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseCsv } from '../src/util.ts';
import { startOllamaStub } from './helpers/ollama-stub.ts';

const ROOT = resolve(import.meta.dirname, '..');
const CSV = `sku,name,brand,variant,mrp,sell_units,units_per_carton,aliases
PRLG5,Parle-G Biscuit,Parle,5 pack,5,packet|carton,144,parle g
SALT1,Tata Salt,Tata,1 kg,28,packet|carton,20,tata namak
TEA250,Tata Tea Premium,Tata,250 g,55,packet|carton,40,tata tea premium
TEA500,Tata Tea Premium,Tata,500 g,90,packet|carton,20,tata tea premium
LAYS10,Lays Classic Salted,Lays,10 pack,10,packet|carton,48,lays classic
LAYS20,Lays Classic Salted,Lays,20 pack,20,packet|carton,24,lays classic
CREAM10,Lays Cream Onion,Lays,10 pack,10,packet|carton,48,lays cream
CREAM20,Lays Cream Onion,Lays,20 pack,20,packet|carton,24,lays cream
KIT10,KitKat,Nestle,10 bar,10,piece|dozen|carton,100,kit kat
SOAP125,Dettol Soap,Dettol,125 g,65,piece|carton,50,dettol soap
OIL1,Fortune Oil,Fortune,1 L pouch,140,piece|carton,12,fortune oil
OIL5,Fortune Oil,Fortune,5 L jar,760,piece,,fortune oil
FROOTI,Frooti,Parle,200 ml,10,piece|carton,27,frooti
`;
let temp: string;
let data: string;
let catalog: string;
let child: ChildProcess | undefined;
let url: string;
let stub: Awaited<ReturnType<typeof startOllamaStub>>;
let processOutput = '';

async function stop() {
  if (!child || child.exitCode !== null) return;
  const proc = child;
  child = undefined;
  proc.kill('SIGTERM');
  await once(proc, 'exit');
}

async function launch(ollamaUrl = stub.url, port = 0) {
  processOutput = '';
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.ts', '--port', String(port), '--data', data, '--catalog', catalog, '--samples', join(temp, 'missing-samples'), '--model', stub.model, '--url', ollamaUrl], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const proc = child;
  await new Promise<void>((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server startup timeout: ${processOutput}`)), 5000);
    const output = (chunk: Buffer) => {
      processOutput += chunk.toString();
      const address = processOutput.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (address) { clearTimeout(timeout); url = address[0]; resolveReady(); }
    };
    proc.stdout!.on('data', output);
    proc.stderr!.on('data', output);
    proc.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`server exited ${code}: ${processOutput}`)); });
  });
}

async function post(path: string, body: unknown) {
  return fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function match(body: unknown) {
  const response = await post('/api/match', body);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/);
  return (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
}
const row = (overrides: Record<string, unknown> = {}) => ({ line: 1, text: 'parle g 5 rs 2 ctn', status: 'confirmed', sku: 'PRLG5', qty: 2, unit: 'carton', ...overrides });
const chats = () => stub.requests.filter((r) => r.path === '/api/chat');

before(async () => {
  temp = mkdtempSync(join(tmpdir(), 'parchimatch-server-'));
  data = join(temp, 'data');
  catalog = join(temp, 'catalog.csv');
  writeFileSync(catalog, CSV);
  stub = await startOllamaStub();
  await launch();
});
after(async () => { await stop(); await stub?.close(); if (temp) rmSync(temp, { recursive: true, force: true }); });

test('server --port 0 reports the actual listening port', async () => {
  await stop();
  await launch();
  assert.notEqual(new URL(url).port, '0');
  assert.equal((await fetch(url + '/api/status')).status, 200);
});

test('status, static assets, samples, and NDJSON comma splitting have documented shapes', async () => {
  const status = await fetch(url + '/api/status');
  assert.equal(status.status, 200);
  assert.equal((await status.json()).modelReady, true);
  for (const path of ['/', '/app.js', '/style.css', '/api/catalog', '/api/samples']) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200, path);
    assert(response.headers.get('content-type'), path);
  }
  stub.reset();
  const events = await match({ text: 'Namaste bhaiya\nparle g 5 rs 2 petti, tata namak 1 kg 3 ctn' });
  assert.deepEqual(events.map((event) => event.type), ['start', 'row', 'row', 'row', 'done']);
  assert.deepEqual(events[0], { type: 'start', total: 3, useModel: true });
  assert.equal(events[1].row.kind, 'note');
  assert.equal(events[2].row.sku, 'PRLG5');
  assert.equal(events[2].row.qty, 2);
  assert.equal(events[3].row.sku, 'SALT1');
  assert.equal(events[3].row.qty, 3);
  assert.equal(chats().length, 0);
});

test('numbers with commas stay in one row through the server: grouped numbers are read, unclear ones asked (A1, S16)', async () => {
  stub.reset();
  const events = await match({ text: 'fortune oil 5 litre 1,200 pcs, tata namak 1 kg 1,500 pkt\ntata namak 1 kg 1,5 pkt' });
  assert.deepEqual(events.map((event) => event.type), ['start', 'row', 'row', 'row', 'done']);
  assert.deepEqual([events[1].row.status, events[1].row.sku, events[1].row.qty, events[1].row.unit], ['ok', 'OIL5', 1200, 'piece']);
  assert.deepEqual([events[2].row.status, events[2].row.sku, events[2].row.qty, events[2].row.unit], ['ok', 'SALT1', 1500, 'packet']);
  assert.equal(events[3].row.status, 'needs_review');
  assert.equal(events[3].row.question, 'What does "1,5" mean?');
  assert.notEqual(events[3].row.qty, 5);
  assert.equal(chats().length, 0);
});

test('status and matching fall back safely when Ollama is down or model is unavailable', async () => {
  stub.setModels([]);
  assert.equal((await (await fetch(url + '/api/status')).json()).modelReady, false);
  assert.equal((await match({ text: 'parle g 5 rs 2 petti' }))[0].useModel, false);
  stub.setModels([stub.model]);
  const dead = await startOllamaStub();
  const deadUrl = dead.url;
  await dead.close();
  await stop(); await launch(deadUrl);
  try {
    assert.equal((await (await fetch(url + '/api/status')).json()).modelReady, false);
    const events = await match({ text: 'parle g 5 rs 2 petti' });
    assert.equal(events[0].useModel, false);
    assert.equal(events[1].row.status, 'ok');
    assert.equal(events[1].row.sku, 'PRLG5');
  } finally { await stop(); await launch(); }
});

test('NDJSON delivers start and completed rows while a later model reply is still blocked', async () => {
  stub.reset();
  let release!: () => void;
  const blocked = new Promise<void>((resolveReply) => { release = resolveReply; });
  stub.setHandler(async () => { await blocked; return { content: { evidence: 'mystery', sku: '', status: 'needs_review' } }; });
  try {
    const response = await fetch(url + '/api/match', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: ['parle g 5 rs 2 ctn', 'mystery 2 ctn'] }), signal: AbortSignal.timeout(5000) });
    const reader = response.body!.getReader();
    let delivered = '';
    while (delivered.split('\n').filter(Boolean).length < 2 || !delivered.endsWith('\n')) {
      const part = await reader.read();
      assert.equal(part.done, false);
      delivered += new TextDecoder().decode(part.value);
    }
    const initial = delivered.trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(initial.map((event) => event.type), ['start', 'row']);
    assert.equal(initial[0].total, 2);
    assert.equal(initial[1].row.sku, 'PRLG5');
    release();
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      delivered += new TextDecoder().decode(part.value);
    }
    assert.deepEqual(delivered.trim().split('\n').map((line) => JSON.parse(line).type), ['start', 'row', 'row', 'done']);
  } finally { release(); stub.reset(); }
});

test('model path rejects wrong prices, outside candidates, near ties, invalid JSON twice, and HTTP 500', async () => {
  stub.reset();
  stub.enqueue({ content: { evidence: 'mystery', sku: 'KIT10', status: 'ok' } });
  let events = await match({ text: 'mystery 5 rs 2 carton' });
  assert.equal(events[1].row.status, 'needs_review');
  assert(events[1].row.reasons.some((reason: string) => reason.includes('order says ₹5 but KIT10 is ₹10')));
  assert.match(chats()[0].body.messages[1].content, /Price written in the order: ₹5/);
  assert.equal(chats()[0].body.format.properties.qty, undefined);
  assert.equal(chats()[0].body.format.properties.unit, undefined);
  stub.reset();
  stub.setHandler((request) => {
    const prompt = request.body.messages[1].content;
    const outside = CSV.split('\n').slice(1).map((line) => line.split(',')[0]).find((sku) => sku && !prompt.includes(`sku=${sku} |`));
    assert(outside, 'catalogue contains more products than the shortlist');
    return { content: { evidence: 'mystery', sku: outside, status: 'ok' } };
  });
  events = await match({ text: 'mystery 2 carton' });
  assert.equal(events[1].row.status, 'needs_review');
  assert.equal(events[1].row.sku, null);
  assert(events[1].row.reasons.some((reason: string) => reason.includes('not among the candidates')));
  stub.reset();
  stub.enqueue({ content: { evidence: 'lays', sku: 'LAYS10', status: 'ok' } });
  events = await match({ text: 'lays 10 rs 2 ctn' });
  assert.equal(events[1].row.status, 'needs_review');
  assert.equal(events[1].row.sku, 'LAYS10');
  assert(events[1].row.reasons.some((reason: string) => reason.includes('about as well')));
  stub.reset();
  stub.enqueue({ content: 'broken {' }, { content: 'still broken' });
  events = await match({ text: 'mystery 2 ctn' });
  assert.equal(events[1].row.status, 'needs_review');
  assert(events[1].row.reasons.includes('model reply was not valid JSON'));
  assert.equal(chats().length, 2);
  assert.equal(chats()[1].body.messages.at(-1).role, 'user');
  stub.reset(); stub.enqueue({ status: 500, error: 'synthetic failure' });
  events = await match({ text: 'mystery 2 ctn' });
  assert.equal(events[1].row.status, 'needs_review');
  assert(events[1].row.reasons.some((reason: string) => reason.includes('Ollama 500')));
  assert.equal((await fetch(url + '/api/status')).status, 200);
});

test('invalid JSON repair and unsupported think fallback are exercised against the stub', async () => {
  stub.reset();
  stub.enqueue({ status: 400, error: 'think is not supported' }, { content: 'invalid' }, { content: { evidence: 'mystery', sku: '', status: 'needs_review' } });
  const events = await match({ text: 'mystery 2 ctn' });
  assert.equal(events[1].row.status, 'needs_review');
  assert.equal(chats().length, 3);
  assert.equal(chats()[0].body.think, false);
  assert.equal('think' in chats()[1].body, false);
  assert.equal('think' in chats()[2].body, false);
});

test('concurrent matching returns 409 and busy resets after completion', async () => {
  stub.reset(); stub.enqueue({ delayMs: 250, content: { evidence: 'mystery', sku: '', status: 'needs_review' } });
  const first = await post('/api/match', { text: 'mystery 2 ctn' });
  assert.equal(first.status, 200);
  const second = await post('/api/match', { text: 'parle g 5 rs 2 ctn' });
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /Already matching/);
  assert.match(await first.text(), /"type":"done"/);
  assert.equal((await match({ text: 'parle g 5 rs 2 ctn' }))[1].row.status, 'ok');
});

test('concurrent request bodies cannot both acquire the matching slot', async () => {
  stub.reset();
  stub.enqueue({ delayMs: 300, content: { evidence: 'mystery', sku: '', status: 'needs_review' } });
  const lateBody = request(url + '/api/match', { method: 'POST', headers: { 'content-type': 'application/json' } });
  const lateResponse = new Promise<number>((resolveStatus, reject) => {
    lateBody.once('response', (response) => { response.resume(); response.once('end', () => resolveStatus(response.statusCode!)); });
    lateBody.once('error', reject);
  });
  lateBody.write('{"text":');
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
  const running = await post('/api/match', { text: 'mystery 2 ctn' });
  lateBody.end('"parle g 5 rs 2 ctn"}');
  const status = await lateResponse;
  await running.text();
  assert.equal(status, 409, 'slot must be checked after awaiting a request body');
});

test('client disconnect cancels remaining matching lines and promptly releases busy', async () => {
  stub.reset();
  stub.enqueue({ delayMs: 1000, content: { evidence: 'mystery', sku: '', status: 'needs_review' } });
  const controller = new AbortController();
  const first = await fetch(url + '/api/match', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: ['mystery 2 ctn', 'mystery 3 ctn', 'mystery 4 ctn'] }), signal: controller.signal });
  const reader = first.body!.getReader();
  await reader.read();
  const startedDeadline = performance.now() + 500;
  while (chats().length === 0 && performance.now() < startedDeadline) await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
  assert.equal(chats().length, 1, 'disconnect occurs while the first slow model request is in flight');
  controller.abort();
  await reader.cancel().catch(() => {});
  const deadline = performance.now() + 500;
  let nextStatus = 409;
  do {
    const next = await post('/api/match', { text: 'parle g 5 rs 2 ctn' });
    nextStatus = next.status;
    await next.text();
    assert([200, 409].includes(nextStatus));
    if (nextStatus === 200) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  } while (performance.now() < deadline);
  assert.equal(nextStatus, 200, 'disconnected work must release busy without waiting for slow Ollama');
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1100));
  assert(chats().length <= 1, `remaining lines made ${chats().length} model calls`);
});

test('confirm rejects unknown products, units, zero, fractions, and excessive quantities', async () => {
  for (const change of [{ sku: 'NOPE' }, { unit: 'bag' }, { qty: 0 }, { qty: 1.5 }, { qty: 10001 }]) {
    const response = await post('/api/confirm', { rows: [row(change)], remember: [] });
    assert.equal(response.status, 400, JSON.stringify(change));
    assert((await response.json()).errors.length > 0);
  }
});

test('confirm exports base quantities, keeps skipped rows, and persists each export separately', async () => {
  const body = { rows: [row(), row({ line: 2, text: 'kit kat 10 rs 4 dozen', sku: 'KIT10', qty: 4, unit: 'dozen' }), row({ line: 3, status: 'skipped', sku: null, qty: null, unit: null })], remember: [] };
  const response = await post('/api/confirm', body);
  assert.equal(response.status, 200);
  const result = await response.json();
  const parsed = parseCsv(result.csv);
  assert.equal(parsed[0].base_qty, '288');
  assert.equal(parsed[0].base_unit, 'packet');
  assert.equal(parsed[1].base_qty, '48');
  assert.equal(parsed[1].base_unit, 'piece');
  assert.equal(parsed[2].status, 'skipped');
  assert.equal(readFileSync(result.file, 'utf8'), result.csv);
  assert(result.file.startsWith(join(data, 'exports')));
  const second = await (await post('/api/confirm', { rows: [row({ qty: 3 })], remember: [] })).json();
  assert.notEqual(result.file, second.file, 'two exports within a second must not overwrite an earlier order');
  assert.equal(readFileSync(result.file, 'utf8'), result.csv);
});

test('L1 known catalogue names cannot be learned through confirm', async () => {
  const response = await post('/api/confirm', { rows: [row({ text: 'tata tea premium 250 g 2 ctn', sku: 'TEA250' })], remember: [{ alias: 'tata tea premium', sku: 'TEA250' }] });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).learned, 0);
});

test('L5 remember requires an explicitly confirmed matching row and name', async () => {
  for (const [alias, rows, sku] of [
    ['ghost alias', [], 'LAYS10'],
    ['skipped alias', [row({ text: 'skipped alias 10 rs 2 ctn', status: 'skipped' })], 'LAYS10'],
    ['unrelated alias', [row()], 'LAYS10'],
    ['wrong product', [row({ text: 'wrong product 10 rs 2 ctn', sku: 'LAYS10' })], 'CREAM10'],
    ['automatic alias', [row({ text: 'automatic alias 10 rs 2 ctn', sku: 'LAYS10', note: 'automatic' })], 'LAYS10'],
  ] as const) {
    const result = await (await post('/api/confirm', { rows, remember: [{ alias, sku }] })).json();
    assert.equal(result.learned, 0, alias);
  }
});

test('learned names survive restart and select price/size variants, but ask without either', async () => {
  let response = await post('/api/confirm', { rows: [row({ text: 'lais peela 10 rs 2 ctn', sku: 'LAYS10' }), row({ line: 2, text: 'chai sundar 250 g 2 ctn', sku: 'TEA250' })], remember: [{ alias: 'LAIS PEELA!!!', sku: 'LAYS10' }, { alias: 'chai sundar', sku: 'TEA250' }] });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).learned, 2);
  await stop(); await launch();
  const events = await match({ lines: ['lais peela 20 rs 2 ctn', 'chai sundar 500 g 3 ctn', 'lais peela 2 ctn', 'chai sundar 2 ctn'] });
  assert.equal(events[1].row.source, 'learned');
  assert.equal(events[1].row.sku, 'LAYS20');
  assert.equal(events[1].row.status, 'ok');
  assert.equal(events[2].row.sku, 'TEA500');
  assert.equal(events[2].row.status, 'ok');
  assert.equal(events[3].row.status, 'needs_review');
  assert.equal(events[4].row.status, 'needs_review');
  assert(readFileSync(join(data, 'aliases_learned.csv'), 'utf8').includes('lais peela,LAYS10,'));
});

test('catalogue replacement validates first, rolls back errors, and safely ignores removed learned SKUs', async () => {
  const before = await (await fetch(url + '/api/catalog')).json();
  let response = await post('/api/catalog', { csv: CSV.replace('packet|carton,144', 'banana,144') });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /row 2: unknown unit "banana"/);
  assert.deepEqual(await (await fetch(url + '/api/catalog')).json(), before);
  response = await post('/api/catalog', { csv: CSV.replace('PRLG5,Parle-G Biscuit,', 'PRLG5,,') });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /row 2: missing name/);
  assert.deepEqual(await (await fetch(url + '/api/catalog')).json(), before);
  response = await post('/api/catalog', { csv: CSV.split('\n')[0] + '\n' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /catalogue has no items/);
  assert.deepEqual(await (await fetch(url + '/api/catalog')).json(), before);
  assert.equal((await match({ text: 'parle g 5 rs 2 ctn' }))[1].row.sku, 'PRLG5');
  const reduced = CSV.split('\n').filter((line) => !line.startsWith('LAYS')).join('\n');
  response = await post('/api/catalog', { csv: reduced });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items, before.length - 2);
  stub.reset();
  const events = await match({ text: 'lais peela 20 rs 2 ctn' });
  assert.notEqual(events[1].row.source, 'learned');
  assert.equal(events[1].row.status, 'needs_review');
  await post('/api/catalog', { csv: CSV });
});

test('uploaded catalogue survives on disk but startup still uses the explicit catalogue flag (characterization)', async () => {
  const reduced = CSV.split('\n').filter((line) => !line.startsWith('LAYS')).join('\n');
  const uploaded = await post('/api/catalog', { csv: reduced });
  assert.equal(uploaded.status, 200);
  assert.equal((await uploaded.json()).items, 11);
  await stop(); await launch();
  assert.equal((await (await fetch(url + '/api/status')).json()).items, 13);
  assert.equal(readFileSync(join(data, 'catalog.csv'), 'utf8'), reduced);
});

test('malformed JSON and invalid request shapes return 400 without crashing', async (t) => {
  for (const path of ['/api/match', '/api/confirm', '/api/catalog']) {
    await t.test(`${path} malformed JSON`, async () => {
      const response = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
      assert.equal(response.status, 400);
      assert(response.headers.get('content-type'));
    });
    for (const body of [null, [], {}, { rows: null, lines: 4, csv: 5 }, { rows: [null], lines: [null] }]) {
      await t.test(`${path}: ${JSON.stringify(body)}`, async () => {
        const response = await post(path, body);
        await response.text();
        assert.equal(response.status, 400);
        assert(response.headers.get('content-type'));
      });
    }
  }
  assert.equal((await fetch(url + '/api/status')).status, 200);
});

test('oversized match and catalogue bodies return 413 with content type', async () => {
  for (const [path, limit] of [['/api/match', 1_000_000], ['/api/catalog', 5_000_000]] as const) {
    const response = await post(path, { text: 'x'.repeat(limit + 1), csv: 'x'.repeat(limit + 1) });
    assert.equal(response.status, 413, path);
    assert(response.headers.get('content-type'));
  }
});

test('unknown routes, wrong methods, and traversal paths never expose project files', async () => {
  for (const [method, path] of [['GET', '/missing'], ['PUT', '/api/match'], ['DELETE', '/api/catalog'], ['POST', '/'], ['GET', '/../package.json'], ['GET', '/%2e%2e/package.json'], ['GET', '/%2e%2e%2fpackage.json'], ['GET', '/app.js/../../package.json'], ['GET', '/.git/config']]) {
    const response = await fetch(url + path, { method });
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await response.json(), { error: 'not found' });
  }
  assert(readdirSync(data).every((name) => name !== 'results'));
});

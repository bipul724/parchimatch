// Purpose: which catalogue the server loads at start (A2, HTTP-08). An explicit --catalog wins; otherwise a
// catalogue uploaded in the app (<data>/catalog.csv) is reused after a restart; otherwise the synthetic default.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadCatalog } from '../src/catalog.ts';
import { startOllamaStub } from './helpers/ollama-stub.ts';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_ITEMS = loadCatalog(join(ROOT, 'data/synthetic/catalog.csv')).length;
const UPLOAD = `sku,name,brand,variant,mrp,sell_units,units_per_carton,aliases
PRLG5,Parle-G Biscuit,Parle,5 pack,5,packet|carton,144,parle g
SALT1,Tata Salt,Tata,1 kg,28,packet|carton,20,tata namak
`;
const FLAG = `${UPLOAD}KIT10,KitKat,Nestle,10 bar,10,piece|dozen|carton,100,kit kat
`;
let temp: string;
let stub: Awaited<ReturnType<typeof startOllamaStub>>;
let child: ChildProcess | undefined;

async function stop() {
  if (!child || child.exitCode !== null) return;
  const proc = child;
  child = undefined;
  proc.kill('SIGTERM');
  await once(proc, 'exit');
}

// Starts the server on port 0 with its own data folder and returns its URL plus everything it printed.
async function start(data: string, extra: string[] = []) {
  await stop();
  let output = '';
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.ts', '--port', '0', '--data', data, '--samples', join(temp, 'missing-samples'), '--model', stub.model, '--url', stub.url, ...extra], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const proc = child;
  const url = await new Promise<string>((ready, reject) => {
    const timeout = setTimeout(() => reject(new Error(`server startup timeout: ${output}`)), 5000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      const address = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      // Wait for the catalogue line too, so the test sees why that catalogue was chosen.
      if (address && /catalogue \d+ items/.test(output)) { clearTimeout(timeout); ready(address[0]); }
    };
    proc.stdout!.on('data', collect);
    proc.stderr!.on('data', collect);
    proc.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`server exited ${code}: ${output}`)); });
  });
  const status = await (await fetch(url + '/api/status')).json();
  return { url, status, output: () => output };
}

const freshData = (name: string) => {
  const dir = join(temp, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};

before(async () => {
  temp = mkdtempSync(join(tmpdir(), 'parchimatch-startup-'));
  stub = await startOllamaStub();
});
after(async () => { await stop(); await stub?.close(); if (temp) rmSync(temp, { recursive: true, force: true }); });

test('nothing uploaded and no --catalog: the synthetic default loads and the log says why', async () => {
  const { status, output } = await start(freshData('empty'));
  assert.equal(status.items, DEFAULT_ITEMS);
  assert.equal(status.catalog, 'data/synthetic/catalog.csv');
  assert.match(output(), /catalogue \d+ items \(data\/synthetic\/catalog\.csv · default: no --catalog and nothing uploaded\)/);
});

test('a catalogue uploaded in the app is reused after a restart without --catalog', async () => {
  const data = freshData('uploaded');
  const first = await start(data);
  assert.equal(first.status.items, DEFAULT_ITEMS);
  const uploaded = await fetch(first.url + '/api/catalog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv: UPLOAD }) });
  assert.equal(uploaded.status, 200);
  const { status, output } = await start(data);
  assert.equal(status.items, 2);
  assert.equal(status.catalog, join(data, 'catalog.csv'));
  assert.match(output(), /catalogue 2 items \(.*catalog\.csv · uploaded in the app\)/);
  assert.doesNotMatch(output(), /warning/i);
});

test('an explicit --catalog always wins over a saved upload', async () => {
  const data = freshData('flag');
  writeFileSync(join(data, 'catalog.csv'), UPLOAD);
  const flag = join(temp, 'flag-catalog.csv');
  writeFileSync(flag, FLAG);
  const { status, output } = await start(data, ['--catalog', flag]);
  assert.equal(status.items, 3);
  assert.match(output(), /catalogue 3 items \(.*flag-catalog\.csv · --catalog\)/);
});

test('an invalid saved upload falls back to the default with a logged warning instead of crashing', async () => {
  const data = freshData('invalid');
  writeFileSync(join(data, 'catalog.csv'), 'sku,name,brand,variant,mrp,sell_units,units_per_carton,aliases\nBAD1,Broken,X,1 pc,5,crate,,broken\n');
  const { status, output } = await start(data);
  assert.equal(status.items, DEFAULT_ITEMS);
  assert.match(output(), /warning: saved catalogue .*catalog\.csv can't be used.*unknown unit "crate"/s);
  assert.match(output(), /catalogue \d+ items \(data\/synthetic\/catalog\.csv · default: saved upload unusable\)/);
});

test('an empty saved upload falls back to the default with a logged warning', async () => {
  const data = freshData('blank');
  writeFileSync(join(data, 'catalog.csv'), '');
  const { status, output } = await start(data);
  assert.equal(status.items, DEFAULT_ITEMS);
  assert.match(output(), /warning: saved catalogue .*catalog\.csv can't be used.*no items/s);
});

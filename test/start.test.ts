// Purpose: the one-command start (A5). It checks Node, Ollama and the model, never downloads anything,
// starts the server (fuzzy-only when the model can't be used), and opens a browser only when asked.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nodeVersionOk, openCommand } from '../src/start.ts';
import { startOllamaStub } from './helpers/ollama-stub.ts';

const ROOT = resolve(import.meta.dirname, '..');
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

// Runs `npm run app` equivalent with a temp data folder and port 0; resolves once the server is listening.
async function app(args: string[]) {
  await stop();
  let output = '';
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/start.ts', '--port', '0', '--data', join(temp, 'data'), '--samples', join(temp, 'missing-samples'), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const proc = child;
  const url = await new Promise<string>((ready, reject) => {
    const timeout = setTimeout(() => reject(new Error(`start timeout: ${output}`)), 8000);
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      // The Ollama message also contains a 127.0.0.1 URL; the server's own line names the app.
      const address = output.match(/ParchiMatch Lite → (http:\/\/127\.0\.0\.1:\d+)/);
      if (address && /catalogue \d+ items/.test(output)) { clearTimeout(timeout); ready(address[1]); }
    };
    proc.stdout!.on('data', collect);
    proc.stderr!.on('data', collect);
    proc.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`start exited ${code}: ${output}`)); });
  });
  const status = await (await fetch(url + '/api/status')).json();
  return { proc, url, status, output: () => output };
}

before(async () => {
  temp = mkdtempSync(join(tmpdir(), 'parchimatch-start-'));
  stub = await startOllamaStub();
});
after(async () => { await stop(); await stub?.close(); if (temp) rmSync(temp, { recursive: true, force: true }); });

test('Ollama stopped: starts fuzzy-only with a clear message, and stopping it stops the server', async () => {
  const dead = await startOllamaStub();
  const deadUrl = dead.url;
  await dead.close();
  const { proc, url, status, output } = await app(['--url', deadUrl, '--model', 'test-model']);
  assert.equal(status.modelReady, false);
  assert.match(output(), /Ollama isn't running at http:\/\/127\.0\.0\.1:\d+/);
  assert.match(output(), /fuzzy matching only/);
  assert.match(output(), /ParchiMatch Lite → http:\/\/127\.0\.0\.1:\d+/);
  assert.doesNotMatch(output(), /Opening/);
  proc.kill('SIGTERM');
  await once(proc, 'exit');
  child = undefined;
  await assert.rejects(fetch(url + '/api/status'), 'the server stops with the start script');
});

test('Ollama running with the model: starts with the model ready', async () => {
  stub.reset();
  stub.setModels([stub.model]);
  const { status, output } = await app(['--url', stub.url, '--model', stub.model]);
  assert.equal(status.modelReady, true);
  assert.match(output(), /Model test-model is ready/);
  assert.doesNotMatch(output(), /ollama pull/);
  await stop();
});

test('Ollama running without the model: prints the exact pull command, downloads nothing, starts fuzzy-only', async () => {
  stub.reset();
  stub.setModels(['some-other-model']);
  try {
    const { status, output } = await app(['--url', stub.url, '--model', stub.model]);
    assert.equal(status.modelReady, false);
    assert.match(output(), /\n {2}ollama pull test-model\n/);
    assert.match(output(), /fuzzy matching only/);
    assert.ok(stub.requests.every((r) => r.method === 'GET'), `only read-only Ollama calls: ${stub.requests.map((r) => `${r.method} ${r.path}`).join(', ')}`);
    assert.ok(!stub.requests.some((r) => /pull/.test(r.path)));
  } finally {
    stub.setModels([stub.model]);
    await stop();
  }
});

test('Node version check needs Node 24 or newer', () => {
  for (const v of ['24.0.0', '24.3.0', '25.1.0', 'v24.21.0']) assert.equal(nodeVersionOk(v), true, v);
  for (const v of ['23.11.0', '22.6.0', 'v20.0.0', '']) assert.equal(nodeVersionOk(v), false, v);
});

test('--open uses the platform browser opener; nothing opens without it', () => {
  assert.deepEqual(openCommand('darwin', 'http://127.0.0.1:5178'), ['open', ['http://127.0.0.1:5178']]);
  assert.deepEqual(openCommand('win32', 'http://127.0.0.1:5178'), ['cmd', ['/c', 'start', '', 'http://127.0.0.1:5178']]);
  assert.deepEqual(openCommand('linux', 'http://127.0.0.1:5178'), ['xdg-open', ['http://127.0.0.1:5178']]);
});

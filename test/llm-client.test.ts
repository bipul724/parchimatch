// Purpose: verify Ollama discovery and successful repaired choices through the real local HTTP client.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableModels, decide, loadedModels } from '../src/llm.ts';
import { startOllamaStub } from './helpers/ollama-stub.ts';

test('Ollama stub implements tags and ps with recorded discovery requests', async (t) => {
  const stub = await startOllamaStub({ models: ['offline-test-a', 'offline-test-b'] });
  t.after(() => stub.close());
  assert.deepEqual(await availableModels(stub.url), ['offline-test-a', 'offline-test-b']);
  assert.deepEqual(await loadedModels(stub.url), [
    { name: 'offline-test-a', size: 1, size_vram: 1 },
    { name: 'offline-test-b', size: 1, size_vram: 1 },
  ]);
  assert.deepEqual(stub.requests.map(({ method, path }) => [method, path]), [['GET', '/api/tags'], ['GET', '/api/ps']]);
  stub.setTagsStatus(500);
  assert.equal(await availableModels(stub.url), null);
});

test('invalid JSON then valid JSON repairs exactly once and returns a usable product choice', async (t) => {
  const stub = await startOllamaStub({ steps: [
    { content: 'not json' },
    { content: { evidence: 'parle g', sku: 'PRLG-5', status: 'ok' } },
  ] });
  t.after(() => stub.close());
  const result = await decide({ url: stub.url, model: stub.model, think: false, numCtx: 2048 }, [{ role: 'user', content: 'parle g 5 rs 2 ctn' }]);
  assert.deepEqual(result.proposal, { evidence: 'parle g', sku: 'PRLG-5', status: 'ok' });
  assert.equal(result.trace.validFirstTry, false);
  assert.equal(result.trace.retries, 1);
  const requests = stub.requests.filter((request) => request.path === '/api/chat');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.messages.at(-2).content, 'not json');
  assert.match(requests[1].body.messages.at(-1).content, /JSON only/);
  assert.equal(requests[0].body.options.temperature, 0);
  assert.equal(requests[0].body.options.seed, 7);
});

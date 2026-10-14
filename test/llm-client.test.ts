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

test('the trace carries Ollama token counts, summed over the repair retry, and null when Ollama sends none', async (t) => {
  const reply = (content: unknown, prompt?: number, output?: number) => ({ body: { message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, ...(prompt === undefined ? {} : { prompt_eval_count: prompt, eval_count: output }) } });
  const ok = { evidence: 'parle g', sku: 'PRLG-5', status: 'ok' };
  const stub = await startOllamaStub({ steps: [reply(ok, 120, 15), reply('not json', 100, 5), reply(ok, 110, 9), reply(ok)] });
  t.after(() => stub.close());
  const cfg = { url: stub.url, model: stub.model, think: false, numCtx: 2048 };
  const msgs = [{ role: 'user' as const, content: 'parle g 5 rs 2 ctn' }];
  const one = await decide(cfg, msgs);
  assert.deepEqual([one.trace.promptTokens, one.trace.outputTokens], [120, 15]);
  const repaired = await decide(cfg, msgs);
  assert.equal(repaired.trace.retries, 1);
  assert.deepEqual([repaired.trace.promptTokens, repaired.trace.outputTokens], [210, 14]);
  const none = await decide(cfg, msgs);
  assert.deepEqual(none.proposal, ok);
  assert.deepEqual([none.trace.promptTokens, none.trace.outputTokens], [null, null]);
  stub.enqueue({ status: 500, error: 'boom' });
  const failed = await decide(cfg, msgs);
  assert.equal(failed.proposal, null);
  assert.deepEqual([failed.trace.promptTokens, failed.trace.outputTokens], [null, null]);
});

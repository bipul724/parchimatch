// Purpose: challenge hybrid on development gold labels using hostile, deterministic candidate picks over real HTTP.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog.ts';
import { makeCtx, run } from '../src/methods.ts';
import { parse } from '../src/text.ts';
import type { Case } from '../src/types.ts';
import { mulberry32, readJsonl } from '../src/util.ts';
import { startOllamaStub } from './helpers/ollama-stub.ts';

const catalog = loadCatalog(fileURLToPath(new URL('../data/synthetic/catalog.csv', import.meta.url)));
const cases = readJsonl<Case>(fileURLToPath(new URL('../data/synthetic/dev.jsonl', import.meta.url)));

test('hybrid adversarial dev safety: random candidate SKUs never auto-accept a wrong gold row', async (t) => {
  let random = mulberry32(20261013);
  let position: number | null = null;
  const stub = await startOllamaStub({ handler: (request) => {
    const prompt = request.body.messages[1].content as string;
    const skus = [...prompt.matchAll(/^- sku=([^ |]+)/gm)].map((match) => match[1]);
    assert.ok(skus.length > 0 && skus.length <= 8, 'real candidate shortlist must reach stub');
    const line = JSON.parse(prompt.match(/^Order line: (.*)\n/)![1]) as string;
    return { content: { sku: skus[position === null ? Math.floor(random() * skus.length) : position % skus.length], status: 'ok', evidence: parse(line).productText || line } };
  } });
  t.after(() => stub.close());
  const ctx = makeCtx(catalog, { llm: { url: stub.url, model: stub.model, think: false, numCtx: 2048 } });
  const slips: unknown[] = [];
  let accepted = 0;
  const audit = async (label: string) => {
    for (const c of cases) {
      const { prediction: actual } = await run('hybrid', c.text, ctx);
      if (actual.status !== 'ok') continue;
      accepted++;
      if (c.gold.status !== 'ok' || actual.sku !== c.gold.sku || actual.qty !== c.gold.qty || actual.unit !== c.gold.unit) {
        slips.push({ label, id: c.id, text: c.text, gold: c.gold, actual });
      }
    }
  };
  for (const seed of [20261013, 7, 2026]) {
    random = mulberry32(seed);
    await audit(`seed=${seed}`);
  }
  // Enumerate every position as well: a lucky random draw must not hide an unsafe candidate.
  for (position = 0; position < 8; position++) await audit(`candidate-position=${position}`);
  const chats = stub.requests.filter((r) => r.path === '/api/chat');
  assert.ok(chats.length > 0, 'model path must actually run');
  assert.ok(accepted > 0, 'control rows must still auto-accept');
  t.diagnostic(`${cases.length} dev lines × 11 passes; ${chats.length} adversarial model calls; ${accepted} accepted rows; ${slips.length} slips`);
  assert.deepEqual(slips, [], JSON.stringify(slips, null, 2));
});

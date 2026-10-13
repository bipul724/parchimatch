import { loadCatalog, numberNamePhrases } from './catalog.ts';
import { findLeaks } from './checkleak.ts';
import { buildMessages, targetJson } from './prompt.ts';
import { retrieve } from './retrieve.ts';
import { parse } from './text.ts';
import type { Case } from './types.ts';
import { parseArgs, readJsonl, writeJsonl } from './util.ts';

// Labelled lines (dev split and/or synthetic) → chat JSONL for LoRA fine-tuning.
// Uses the same candidate retrieval and prompt as inference, and refuses to export anything close to the test set.
// Usage: npm run export-train -- --catalog data/real/catalog.csv --in data/real/dev.jsonl,data/real/synthetic.jsonl --test data/real/test.jsonl
const args = parseArgs(process.argv.slice(2));
const catalog = loadCatalog(String(args.catalog ?? 'data/real/catalog.csv'));
const inputs = String(args.in ?? '').split(',').filter(Boolean);
const testPath = String(args.test ?? 'data/real/test.jsonl');
const out = String(args.out ?? 'data/train/chat.jsonl');
const k = Number(args.k ?? 8);
if (inputs.length === 0) {
  console.error('Usage: npm run export-train -- --catalog <csv> --in <dev.jsonl>[,<synthetic.jsonl>] --test <test.jsonl> [--out data/train/chat.jsonl]');
  process.exit(1);
}

const cases = inputs.flatMap((p) => readJsonl<Case>(p));
const leaks = findLeaks(readJsonl<Case>(testPath).map((c) => c.text), cases.map((c) => c.text), 0.85);
if (leaks.length) {
  for (const l of leaks.slice(0, 20)) console.error(`${l.similarity}  "${l.candidate}"  ~  test "${l.test}"`);
  console.error(`✗ ${leaks.length} training lines are near-duplicates of test lines. Fix them, then export again.`);
  process.exit(1);
}

let goldMissing = 0;
const rows = cases.map((c) => {
  const parsed = parse(c.text, { namePhrases: numberNamePhrases(catalog) });
  const shown = retrieve(parsed, catalog, k).map((r) => r.item);
  // Mirror inference: if retrieval did not surface the right product, the correct reply is to ask.
  const reachable = c.gold.sku === null || shown.some((s) => s.sku === c.gold.sku);
  if (!reachable) goldMissing++;
  // The model is trained on its narrower job: which product. Quantity problems are code's, so a line whose
  // product is clear but quantity is missing is still "ok" for the model.
  const productClear = reachable && c.gold.sku !== null;
  const target = { sku: productClear ? c.gold.sku : null, status: productClear ? ('ok' as const) : ('needs_review' as const), evidence: parsed.productText };
  return { id: c.id, messages: [...buildMessages(c.text, shown, parsed), { role: 'assistant', content: targetJson(target) }] };
});

writeJsonl(out, rows);
console.log(`✓ ${rows.length} training conversations → ${out}`);
if (goldMissing) console.log(`! ${goldMissing} lines had the correct product outside the top ${k}; they were exported as "needs_review". Improve aliases or retrieval if this is high.`);

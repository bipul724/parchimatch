// Purpose: check deterministic parser and finalizer safety invariants using seeded dev-data mutations.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bySku, loadCatalog, variantSize } from '../src/catalog.ts';
import { normalize, parse, sameSize } from '../src/text.ts';
import type { Case } from '../src/types.ts';
import { mulberry32, readJsonl } from '../src/util.ts';
import { finalize } from '../src/validate.ts';

const catalog = loadCatalog(fileURLToPath(new URL('../data/synthetic/catalog.csv', import.meta.url)));
const index = bySku(catalog);
const dev = readJsonl<Case>(fileURLToPath(new URL('../data/synthetic/dev.jsonl', import.meta.url)));
const generated = (seed: number) => {
  const rng = mulberry32(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  const lines = dev.map((c) => c.text);
  for (let i = 0; i < 1200; i++) {
    const item = pick(catalog);
    const alias = pick([item.name, ...item.aliases]);
    const qty = pick(['0', '1', '2', '1.5', '-2', '10000', '10001', 'do', '૨2', '২2', '２', '२']);
    const unit = pick(['ctn', 'packet', 'pcs', 'bag', 'jodi', 'dozen', 'petti']);
    const marker = pick(['', '5/-', 'rs.10', '₹ 20', '1.5kg', '125 ml', '5 rs 10 rs', '1 l 5 l']);
    lines.push(`${alias} ${marker} ${qty}${pick([' ', '-', '\u200b'])}${unit}${pick(['', ' 🙏', ' bhej do', '!!!'])}`);
  }
  return lines;
};

test('seeded parser inputs never throw and normalize is idempotent (seed 20261013)', () => {
  const lines = generated(20261013);
  assert.deepEqual(lines, generated(20261013), 'the generated workload must be reproducible');
  for (const text of lines) {
    assert.doesNotThrow(() => parse(text), text);
    const once = normalize(text);
    assert.equal(normalize(once), once, text);
  }
});

test('seeded finalize never auto-accepts missing, invalid, incompatible, or contradictory values', () => {
  const rng = mulberry32(171717);
  let accepted = 0;
  let reviewed = 0;
  for (const text of generated(20261013)) {
    const parsed = parse(text);
    const chosen = catalog[Math.floor(rng() * catalog.length)];
    const r = finalize({ sku: rng() < 0.05 ? null : chosen.sku, qty: parsed.qty, unit: parsed.unit, status: 'ok', evidence: parsed.productText }, parsed, index, { rawText: text, fromModel: true, allowedSkus: new Set(catalog.map((c) => c.sku)) });
    if (r.status !== 'ok') {
      reviewed++;
      assert.ok(r.reasons.length, text);
      assert.ok(r.question, text);
      continue;
    }
    accepted++;
    assert.ok(r.sku, text);
    const item = index.get(r.sku)!;
    assert.ok(item, text);
    assert.notEqual(r.qty, null, text);
    assert.ok(Number.isInteger(r.qty) && r.qty! > 0 && r.qty! <= 10000, text);
    assert.ok(r.unit && item.sellUnits.includes(r.unit), text);
    if (r.unit === 'carton') assert.notEqual(item.unitsPerCarton, null, text);
    if (parsed.priceHint !== null && item.mrp !== null) assert.equal(item.mrp, parsed.priceHint, text);
    for (const price of parsed.priceHints ?? []) if (item.mrp !== null) assert.equal(item.mrp, price, text);
    if (parsed.sizeHint) {
      const size = variantSize(item);
      assert.ok(size && sameSize(size, parsed.sizeHint), text);
      for (const written of parsed.sizeHints ?? []) assert.ok(sameSize(size!, written), text);
    }
    assert.equal(parsed.unknownUnit, null, text);
  }
  assert.ok(accepted > 0, 'exercise accepted rows as well as rejected rows');
  assert.ok(reviewed > accepted, 'adversarial picks must meaningfully exercise safety checks');
});

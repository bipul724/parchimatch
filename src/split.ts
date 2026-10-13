import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Case } from './types.ts';
import { mulberry32, parseArgs, readJsonl, sha256, writeJsonl } from './util.ts';

// Lock the held-out test set BEFORE generating any synthetic data or tuning thresholds.
// Usage: npm run split -- --in data/real/labelled.jsonl --test 30 --seed 7 --out data/real
const args = parseArgs(process.argv.slice(2));
const input = String(args.in ?? '');
const outDir = String(args.out ?? 'data/real');
const nTest = Number(args.test ?? 30);
const seed = Number(args.seed ?? 7);
if (!input) {
  console.error('Usage: npm run split -- --in <labelled.jsonl> --test 30 --seed 7 --out data/real');
  process.exit(1);
}

const testPath = `${outDir}/test.jsonl`;
const lockPath = `${testPath}.lock.json`;
if (existsSync(lockPath) && !args.force) {
  console.error(`✗ ${lockPath} exists. The test set is already locked; re-splitting would leak it. Use --force only if no results or training data used it.`);
  process.exit(1);
}

const cases = readJsonl<Case>(input);
const ids = new Set<string>();
for (const c of cases) {
  if (ids.has(c.id)) throw new Error(`Duplicate id ${c.id}`);
  ids.add(c.id);
}
if (nTest >= cases.length) throw new Error(`Need more than ${nTest} labelled lines to hold out ${nTest}.`);

// Stratify by expected status so the test set keeps the same share of lines that need a human.
const rand = mulberry32(seed);
const shuffle = <T>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const ok = shuffle(cases.filter((c) => c.gold.status === 'ok'));
const review = shuffle(cases.filter((c) => c.gold.status === 'needs_review'));
const nReview = Math.round((nTest * review.length) / cases.length);
const test = [...review.slice(0, nReview), ...ok.slice(0, nTest - nReview)];
const testIds = new Set(test.map((c) => c.id));
const dev = cases.filter((c) => !testIds.has(c.id));

writeJsonl(testPath, test);
writeJsonl(`${outDir}/dev.jsonl`, dev);
const text = readFileSync(testPath, 'utf8');
writeFileSync(lockPath, JSON.stringify({ created: new Date().toISOString(), seed, n: test.length, sha256: sha256(text), source: input }, null, 2));
console.log(`test ${test.length} (${nReview} need review) → ${testPath} [locked]\ndev ${dev.length} → ${outDir}/dev.jsonl`);
console.log('Use dev.jsonl for threshold tuning, prompt changes and as seeds for synthetic data. Never edit test.jsonl.');

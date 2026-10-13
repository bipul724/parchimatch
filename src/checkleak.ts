import { textSimilarity } from './retrieve.ts';
import { normalize } from './text.ts';
import { parseArgs, readJsonl } from './util.ts';

export interface Leak {
  candidate: string;
  test: string;
  similarity: number;
}

// Flags training lines that copy or nearly copy a held-out test line.
export function findLeaks(testTexts: string[], candidateTexts: string[], threshold: number): Leak[] {
  const tests = testTexts.map(normalize);
  const leaks: Leak[] = [];
  for (const raw of candidateTexts) {
    const c = normalize(raw);
    for (let i = 0; i < tests.length; i++) {
      const sim = c === tests[i] ? 1 : textSimilarity(c, tests[i]);
      if (sim >= threshold) leaks.push({ candidate: raw, test: testTexts[i], similarity: Math.round(sim * 100) / 100 });
    }
  }
  return leaks;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const testPath = String(args.test ?? 'data/real/test.jsonl');
  const candPath = String(args.candidate ?? '');
  const threshold = Number(args.threshold ?? 0.85);
  if (!candPath) {
    console.error('Usage: npm run check-leak -- --test data/real/test.jsonl --candidate data/real/synthetic.jsonl [--threshold 0.85]');
    process.exit(1);
  }
  const leaks = findLeaks(
    readJsonl<{ text: string }>(testPath).map((c) => c.text),
    readJsonl<{ text: string }>(candPath).map((c) => c.text),
    threshold,
  );
  for (const l of leaks) console.log(`${l.similarity}  "${l.candidate}"  ~  test "${l.test}"`);
  console.log(leaks.length ? `✗ ${leaks.length} near-duplicates of test lines. Remove them before training.` : '✓ no near-duplicates of test lines');
  process.exit(leaks.length ? 1 : 0);
}

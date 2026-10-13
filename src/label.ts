import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { bySku, loadCatalog, numberNamePhrases } from './catalog.ts';
import { retrieve } from './retrieve.ts';
import { itemLabel } from './review.ts';
import { parse, UNIT_WORDS } from './text.ts';
import { UNITS } from './types.ts';
import type { Case, Unit } from './types.ts';
import { ensureDir, missingValue, parseArgs, readJsonl } from './util.ts';

// Labels order lines written by other people, for a human-written test set (docs/EVALUATION.md).
// Usage: npm run label -- --catalog <csv> --in <raw.txt> --out <labelled.jsonl>
// One order line per input line. Each answer is appended at once, so stopping (Ctrl+C or end of input) loses
// nothing; running the same command again skips ids already in --out. The id is the input line number (h007),
// so editing the input file afterwards would mislabel lines: a changed line stops the run instead.

const root = resolve(import.meta.dirname, '..');
const USAGE = 'npm run label -- --catalog <csv> --in <raw.txt> --out <labelled.jsonl>';

// Resolves symlinks in the deepest existing part of the path, so "data/synthetic/../synthetic" or a link can't slip past.
function realish(path: string): string {
  let existing = path;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  return join(realpathSync(existing), relative(existing, path));
}

function inside(dir: string, path: string): boolean {
  const rel = relative(realish(dir), realish(path));
  return !rel.startsWith('..') && !isAbsolute(rel);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// Reads answers one line at a time, from a terminal or a pipe. Piped lines that arrive before
// their question is asked are queued rather than lost. null means the input ended (or Ctrl+C).
function answers() {
  const terminal = Boolean(process.stdin.isTTY);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal });
  const queue: string[] = [];
  let waiting: ((line: string | null) => void) | null = null;
  let closed = false;
  rl.on('line', (line) => {
    if (waiting) {
      const w = waiting;
      waiting = null;
      w(line);
    } else queue.push(line);
  });
  rl.on('SIGINT', () => rl.close());
  rl.on('close', () => {
    closed = true;
    if (waiting) {
      const w = waiting;
      waiting = null;
      w(null);
    }
  });
  return {
    ask(prompt: string): Promise<string | null> {
      rl.setPrompt(prompt);
      rl.prompt();
      if (queue.length) return Promise.resolve(queue.shift()!.trim());
      if (closed) return Promise.resolve(null);
      return new Promise((done) => { waiting = (line) => done(line === null ? null : line.trim()); });
    },
    close: () => rl.close(),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const usageError = missingValue(args, { catalog: 'data/synthetic/catalog.csv', in: 'data/human/raw.txt', out: 'data/human/labelled.jsonl' });
  if (usageError) fail(usageError);
  for (const flag of ['catalog', 'in', 'out']) if (args[flag] === undefined) fail(`--${flag} is required: ${USAGE}`);
  const catalogPath = resolve(String(args.catalog));
  const inPath = resolve(String(args.in));
  const outPath = resolve(String(args.out));

  if (inside(join(root, 'data/synthetic'), outPath)) fail(`Labelling won't write into data/synthetic/ (the generated benchmark). Choose another --out, e.g. data/human/labelled.jsonl.`);
  if (existsSync(`${outPath}.lock.json`)) fail(`${outPath} is locked (${basename(outPath)}.lock.json). A locked test set is never edited.`);
  if (realish(outPath) === realish(inPath)) fail('--out must be a different file from --in.');

  const catalog = loadCatalog(catalogPath);
  const index = bySku(catalog);
  const namePhrases = numberNamePhrases(catalog);
  const lines = readFileSync(inPath, 'utf8').split(/\r?\n/).map((text, i) => ({ id: `h${String(i + 1).padStart(3, '0')}`, n: i + 1, text: text.trim() })).filter((l) => l.text);

  const done = new Map((existsSync(outPath) ? readJsonl<Case>(outPath) : []).map((c) => [c.id, c.text]));
  for (const l of lines) {
    if (done.has(l.id) && done.get(l.id) !== l.text) fail(`${l.id} in ${outPath} is "${done.get(l.id)}", but it doesn't match line ${l.n} of ${inPath} ("${l.text}"). The input changed; restore it or use a new --out.`);
  }
  if (!existsSync(outPath)) {
    ensureDir(outPath);
    appendFileSync(outPath, `// Human-written order lines from ${basename(inPath)}, labelled with npm run label against ${basename(catalogPath)} on ${new Date().toISOString().slice(0, 10)}. Not synthetic.\n`);
  }

  const todo = lines.filter((l) => !done.has(l.id));
  let labelled = lines.length - todo.length;
  const input = answers();
  console.log(`${lines.length} order lines, ${labelled} already labelled, ${todo.length} to go. Ctrl+C stops; run again to continue.`);

  for (const [i, l] of todo.entries()) {
    const parsed = parse(l.text, { namePhrases });
    // The same 8 candidates the model is shown, by name (numbers by value: ₹5 before ₹10) and without scores, so fuzzy's ranking doesn't steer the label.
    const top = retrieve(parsed, catalog, 8).map((r) => r.item).sort((a, b) => itemLabel(a).localeCompare(itemLabel(b), 'en', { numeric: true }) || a.sku.localeCompare(b.sku));
    const hints = [
      `qty ${parsed.qty ?? '–'}`, `unit ${parsed.unit ?? '–'}`,
      ...(parsed.priceHint !== null ? [`price ₹${parsed.priceHint}`] : []),
      ...(parsed.sizeHint ? [`size ${parsed.sizeHint.value} ${parsed.sizeHint.dim}`] : []),
      ...(parsed.unknownUnit ? [`unknown unit "${parsed.unknownUnit}"`] : []),
      ...(parsed.unclearNumber ? [`unclear number "${parsed.unclearNumber}"`] : []),
    ];
    console.log(`\n[${i + 1}/${todo.length}] ${l.id}  ${l.text}\n  parsed: ${hints.join(' · ')}`);
    top.forEach((item, k) => console.log(`  ${k + 1}) ${item.sku}  ${itemLabel(item)}`));

    let sku: string | null | undefined;
    while (sku === undefined) {
      const a = await input.ask('Product [number, a SKU, or n = needs review / not stocked]: ');
      if (a === null) break;
      const typed = catalog.find((c) => c.sku.toLowerCase() === a.toLowerCase());
      if (a.toLowerCase() === 'n') sku = null;
      else if (/^\d+$/.test(a) && Number(a) >= 1 && Number(a) <= top.length) sku = top[Number(a) - 1].sku;
      else if (typed) sku = typed.sku;
      else console.log(`  "${a}" is not a number from the list or a SKU in the catalogue.`);
    }
    if (sku === undefined) break;
    if (sku) console.log(`  → ${sku}  ${itemLabel(index.get(sku)!)}`);

    let qty: number | null | undefined;
    while (qty === undefined) {
      const a = await input.ask(`Quantity as ordered [${parsed.qty ?? '-'}] (- = not written or unclear): `);
      if (a === null) break;
      if (a === '') qty = parsed.qty !== null && Number.isInteger(parsed.qty) && parsed.qty > 0 ? parsed.qty : null;
      else if (a === '-') qty = null;
      else if (/^\d+$/.test(a) && Number(a) > 0) qty = Number(a);
      else console.log('  Enter a whole number, - for none, or press Enter to keep the parsed value.');
    }
    if (qty === undefined) break;

    let unit: Unit | null | undefined;
    while (unit === undefined) {
      const a = await input.ask(`Unit as ordered [${parsed.unit ?? '-'}] (${UNITS.join('/')}, - = none): `);
      if (a === null) break;
      const word = a.toLowerCase();
      if (a === '') unit = parsed.unit;
      else if (a === '-') unit = null;
      else if ((UNITS as readonly string[]).includes(word)) unit = word as Unit;
      else if (UNIT_WORDS[word]) unit = UNIT_WORDS[word];
      else console.log(`  "${a}" is not a unit. Use ${UNITS.join(', ')} (or ctn, pkt, dz…), or - for none.`);
    }
    if (unit === undefined) break;

    // A careful person can't enter a row without product, quantity and unit; otherwise it's the labeller's call
    // (e.g. a carton of an item whose carton size nobody knows still needs a question). No default: a stray Enter
    // labelling a line ok would make a system's missed question look safe.
    let status: Case['gold']['status'] | undefined = sku && qty && unit ? undefined : 'needs_review';
    if (status) console.log('  → needs_review (product, quantity or unit missing)');
    while (status === undefined) {
      const a = await input.ask('Could a careful person enter this line without asking anything? [y/n]: ');
      if (a === null) break;
      if (/^y(es)?$/i.test(a)) status = 'ok';
      else if (/^no?$/i.test(a)) status = 'needs_review';
      else console.log('  Answer y or n.');
    }
    if (status === undefined) break;

    const tagAnswer = await input.ask('Tags (comma-separated, optional): ');
    if (tagAnswer === null) break;
    const tags = tagAnswer.split(',').map((t) => t.trim()).filter(Boolean);

    const c: Case = { id: l.id, text: l.text, gold: { sku, qty, unit, status }, tags };
    appendFileSync(outPath, `${JSON.stringify(c)}\n`);
    labelled++;
  }
  input.close();
  const left = lines.length - labelled;
  console.log(left ? `\nStopped. ${labelled} line${labelled === 1 ? '' : 's'} labelled so far, ${left} to go, in ${outPath}. Run the same command again to continue.` : `\nDone. ${labelled} of ${lines.length} lines labelled in ${outPath}.`);
}

if (import.meta.main) {
  main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
}

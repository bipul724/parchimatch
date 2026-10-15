import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { bySku, loadCatalog, numberNamePhrases } from './catalog.ts';
import { retrieve } from './retrieve.ts';
import { splitOrder } from './orderlines.ts';
import { itemLabel } from './review.ts';
import { parse, UNIT_WORDS } from './text.ts';
import { UNITS } from './types.ts';
import type { Case, Unit } from './types.ts';
import { ensureDir, fileProblem, missingValue, parseArgs, readJsonl } from './util.ts';

// Labels order lines written by other people, for a human-written test set (docs/EVALUATION.md).
// Usage: npm run label -- --catalog <csv> --in <raw.txt> --out <labelled.jsonl>
// Paste messages unedited, one message line per input line. Each line is cut into items with the app's own
// splitOrder() (commas, ";", bullets, numbering), so the test set is labelled on exactly the pieces the app matches;
// splitting by hand would quietly fix the splitter's mistakes. Ids come from the line number, plus the item's
// position when a line has several (h007, or h007-1, h007-2). Each answer is appended at once, so stopping
// (Ctrl+C or end of input) loses nothing; a rerun skips ids already labelled in --out or skipped in <out>.skipped.
// Editing the input afterwards would mislabel items, so a changed item stops the run instead.

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
  let raw = '';
  try {
    raw = readFileSync(inPath, 'utf8');
  } catch (e) {
    const missing = (e as { code?: string }).code === 'ENOENT';
    fail(`Can't read ${String(args.in)}: ${fileProblem(e)}.${missing ? ' Save the order lines there first, one per line.' : ''}`);
  }
  const lines = raw.split(/\r?\n/).map((text, i) => ({ n: i + 1, text: text.trim() })).filter((l) => l.text);
  const items = lines.flatMap((l) => {
    const pieces = splitOrder(l.text);
    const base = `h${String(l.n).padStart(3, '0')}`;
    return pieces.map((text, k) => ({ id: pieces.length === 1 ? base : `${base}-${k + 1}`, n: l.n, line: l.text, k: k + 1, of: pieces.length, text }));
  });
  const where = (item: (typeof items)[number]) => `line ${item.n}${item.of > 1 ? `, item ${item.k} of ${item.of}` : ''}`;

  const skippedPath = `${outPath}.skipped`;
  const done = new Map((existsSync(outPath) ? readJsonl<Case>(outPath) : []).map((c) => [c.id, c.text]));
  const skippedBefore = new Map(
    (existsSync(skippedPath) ? readFileSync(skippedPath, 'utf8').split('\n').filter(Boolean) : []).map((row) => {
      const [id, ...text] = row.split('\t');
      return [id, text.join('\t')];
    }),
  );
  for (const item of items) {
    for (const [saved, file] of [[done, outPath], [skippedBefore, skippedPath]] as const) {
      if (saved.has(item.id) && saved.get(item.id) !== item.text) fail(`${item.id} in ${file} is "${saved.get(item.id)}", but it doesn't match ${where(item)} in ${inPath} ("${item.text}"). The input changed; restore it or use a new --out.`);
    }
  }
  if (!existsSync(outPath)) {
    ensureDir(outPath);
    appendFileSync(outPath, `// Human-written order lines from ${basename(inPath)}, labelled with npm run label against ${basename(catalogPath)} on ${new Date().toISOString().slice(0, 10)}. Not synthetic.\n`);
  }

  const todo = items.filter((item) => !done.has(item.id) && !skippedBefore.has(item.id));
  let labelled = items.filter((item) => done.has(item.id)).length;
  let skipped = items.filter((item) => skippedBefore.has(item.id)).length;
  const plural = (n: number) => `${n} item${n === 1 ? '' : 's'}`;
  const input = answers();
  console.log(`${plural(items.length)} from ${lines.length} line${lines.length === 1 ? '' : 's'}: ${labelled} labelled, ${skipped} skipped, ${todo.length} to go. Ctrl+C stops; run again to continue.`);

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
    console.log(`\n[${i + 1}/${todo.length}] ${l.id}  ${l.text}\n  ${where(l)}: ${l.line}\n  parsed: ${hints.join(' · ')}`);
    top.forEach((item, k) => console.log(`  ${k + 1}) ${item.sku}  ${itemLabel(item)}`));

    let sku: string | null | undefined;
    let skip = false;
    while (sku === undefined && !skip) {
      const a = await input.ask('Product [number, a SKU, n = needs review / not stocked, s = skip: not an order item]: ');
      if (a === null) break;
      const typed = catalog.find((c) => c.sku.toLowerCase() === a.toLowerCase());
      if (a.toLowerCase() === 's') skip = true;
      else if (a.toLowerCase() === 'n') sku = null;
      else if (/^\d+$/.test(a) && Number(a) >= 1 && Number(a) <= top.length) sku = top[Number(a) - 1].sku;
      else if (typed) sku = typed.sku;
      else console.log(`  "${a}" is not a number from the list or a SKU in the catalogue.`);
    }
    // Greetings, thanks and notes are not order items: kept out of the test set, but recorded so a rerun doesn't ask again.
    if (skip) {
      appendFileSync(skippedPath, `${l.id}\t${l.text}\n`);
      skipped++;
      console.log('  → skipped (not an order item)');
      continue;
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
  const left = items.length - labelled - skipped;
  console.log(left ? `\nStopped. ${plural(labelled)} labelled, ${skipped} skipped, ${left} to go, in ${outPath}. Run the same command again to continue.` : `\nDone. ${plural(labelled)} labelled, ${skipped} skipped (${plural(items.length)}) in ${outPath}.`);
}

if (import.meta.main) {
  main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
}

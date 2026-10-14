import { appendFileSync, existsSync, readFileSync, statfsSync, writeFileSync } from 'node:fs';
import { freemem, totalmem } from 'node:os';
import { basename } from 'node:path';
import { loadCatalog } from './catalog.ts';
import { availableModels, loadedModels } from './llm.ts';
import { makeCtx, METHODS, run } from './methods.ts';
import type { Method } from './methods.ts';
import type { Case, MethodResult } from './types.ts';
import { ensureDir, missingValue, parseArgs, percentile, readJsonl, sha256 } from './util.ts';

type Outcome = 'auto_correct' | 'auto_wrong' | 'flagged_answerable' | 'flagged_correctly' | 'missed_flag';

interface Scored {
  id: string;
  text: string;
  tags: string[];
  gold: Case['gold'];
  result: MethodResult;
  outcome: Outcome;
  skuCorrect: boolean | null;
  inCandidates: boolean | null;
}

function scoreCase(c: Case, r: MethodResult): Scored {
  const p = r.prediction;
  const full = p.sku === c.gold.sku && p.qty === c.gold.qty && p.unit === c.gold.unit;
  let outcome: Outcome;
  if (c.gold.status === 'ok') outcome = p.status === 'ok' ? (full ? 'auto_correct' : 'auto_wrong') : 'flagged_answerable';
  else outcome = p.status === 'needs_review' ? 'flagged_correctly' : 'missed_flag';
  return {
    id: c.id,
    text: c.text,
    tags: c.tags,
    gold: c.gold,
    result: r,
    outcome,
    skuCorrect: c.gold.sku === null ? null : p.sku === c.gold.sku,
    inCandidates: c.gold.sku === null || !r.candidates ? null : r.candidates.includes(c.gold.sku),
  };
}

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((1000 * n) / d) / 10);
const fmt = (v: number | null, suffix = '%') => (v === null ? '–' : `${v}${suffix}`);

function summarise(rows: Scored[]) {
  const count = (o: Outcome) => rows.filter((r) => r.outcome === o).length;
  const goldOk = rows.filter((r) => r.gold.status === 'ok').length;
  const goldReview = rows.length - goldOk;
  const autos = count('auto_correct') + count('auto_wrong') + count('missed_flag');
  const skuRows = rows.filter((r) => r.skuCorrect !== null);
  const candRows = rows.filter((r) => r.inCandidates !== null);
  const llmRows = rows.filter((r) => r.result.llm);
  // A flagged row whose suggestion (product, qty, unit) is already right needs one tap, not typing.
  const fullMatch = (r: Scored) => {
    const p = r.result.prediction;
    return p.sku === r.gold.sku && p.qty === r.gold.qty && p.unit === r.gold.unit;
  };
  const oneTap = rows.filter((r) => r.outcome === 'flagged_answerable' && fullMatch(r)).length;
  const ms = llmRows.map((r) => r.result.llm!.ms);
  return {
    n: rows.length,
    goldOk,
    goldReview,
    autoCorrect: count('auto_correct'),
    autoWrong: count('auto_wrong'),
    missedFlag: count('missed_flag'),
    flaggedAnswerable: count('flagged_answerable'),
    flaggedCorrectly: count('flagged_correctly'),
    // Headline numbers
    autoAcceptAccuracy: pct(count('auto_correct'), goldOk), // answerable lines handled with no human touch
    dangerousRate: pct(count('auto_wrong') + count('missed_flag'), rows.length), // wrong rows that would reach the bill
    precisionWhenAuto: pct(count('auto_correct'), autos),
    flagRecall: pct(count('flagged_correctly'), goldReview), // lines that needed a human and got one
    reviewLoad: pct(rows.filter((r) => r.result.prediction.status === 'needs_review').length, rows.length),
    oneTap,
    zeroTyping: pct(count('auto_correct') + oneTap, goldOk), // answerable lines done automatically or with one tap
    suggestionAccuracy: pct(oneTap, count('flagged_answerable')), // flagged answerable lines whose suggestion was right
    modelCalls: llmRows.length,
    skuAccuracy: pct(skuRows.filter((r) => r.skuCorrect).length, skuRows.length),
    recallAtK: pct(candRows.filter((r) => r.inCandidates).length, candRows.length),
    validJsonFirstTry: pct(llmRows.filter((r) => r.result.llm!.validFirstTry).length, llmRows.length),
    modelErrors: llmRows.filter((r) => r.result.llm!.error).length,
    p50ms: percentile(ms, 50),
    p95ms: percentile(ms, 95),
  };
}

function byTag(rows: Scored[]) {
  const tags = [...new Set(rows.flatMap((r) => r.tags))].sort();
  return Object.fromEntries(
    tags.map((t) => {
      const rs = rows.filter((r) => r.tags.includes(t));
      const right = rs.filter((r) => r.outcome === 'auto_correct' || r.outcome === 'flagged_correctly').length;
      const dangerous = rs.filter((r) => r.outcome === 'auto_wrong' || r.outcome === 'missed_flag').length;
      return [t, { n: rs.length, right, dangerous }];
    }),
  );
}

// A bad number used to change the measurement silently: "--limit" scored 1 case, "--min-score" became 1.
function invalidNumber(args: Record<string, string | boolean>): string | null {
  const whole = (flag: string, min: number, example: string) =>
    args[flag] !== undefined && !(/^\d+$/.test(String(args[flag])) && Number(args[flag]) >= min) ? `--${flag} must be a whole number from ${min} up, e.g. --${flag} ${example}` : null;
  const fraction = (flag: string, example: string) =>
    args[flag] !== undefined && !(/^(\d+(\.\d*)?|\.\d+)$/.test(String(args[flag])) && Number(args[flag]) <= 1) ? `--${flag} must be a number from 0 to 1, e.g. --${flag} ${example}` : null;
  return whole('limit', 1, '20') ?? whole('k', 1, '8') ?? whole('ctx', 1, '2048') ?? whole('show', 0, '12')
    ?? fraction('min-score', '0.5') ?? fraction('min-margin', '0.08');
}

// Result files are named by the second. Never overwrite one another run wrote in that second: add -2, -3, …
// The exclusive create ('wx') also holds when two runs race for the same name.
function writeNew(base: string, text: string): string {
  for (let n = 1; ; n++) {
    const file = n === 1 ? `${base}.json` : `${base}-${n}.json`;
    try {
      writeFileSync(file, text, { flag: 'wx' });
      return file;
    } catch (e) {
      if ((e as { code?: string }).code !== 'EEXIST') throw e;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const usageError = missingValue(args, {
    catalog: 'data/real/catalog.csv', cases: 'data/synthetic/dev.jsonl', model: 'gemma4:e2b-it-qat',
    url: 'http://127.0.0.1:11434', out: 'results', label: 'my-change', methods: 'exact,fuzzy',
    limit: '20', k: '8', 'min-score': '0.5', 'min-margin': '0.08', ctx: '2048', show: '12',
  }) ?? invalidNumber(args);
  if (usageError) {
    console.error(usageError);
    process.exit(1);
  }
  const catalogPath = String(args.catalog ?? 'data/fixture/catalog.csv');
  const casesPath = String(args.cases ?? 'data/fixture/test.jsonl');
  const methods = String(args.methods ?? 'exact,fuzzy,llm-cand,hybrid').split(',') as Method[];
  const model = String(args.model ?? 'gemma4:e2b-it-qat');
  const url = String(args.url ?? 'http://127.0.0.1:11434');
  const outDir = String(args.out ?? 'results');
  const limit = args.limit ? Number(args.limit) : Infinity;
  const label = args.label ? String(args.label) : '';
  for (const m of methods) if (!METHODS.includes(m)) throw new Error(`Unknown method "${m}". Use: ${METHODS.join(', ')}`);

  const catalog = loadCatalog(catalogPath);
  const casesText = readFileSync(casesPath, 'utf8');
  const cases = readJsonl<Case>(casesPath).slice(0, limit);
  const casesHash = sha256(casesText).slice(0, 12);

  const lockPath = `${casesPath}.lock.json`;
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { sha256: string };
    if (lock.sha256 !== sha256(casesText)) {
      console.error(`✗ ${casesPath} changed after it was locked (${lockPath}). Test-set edits invalidate earlier results.`);
      if (!args['allow-changed-test']) process.exit(1);
    }
  }

  const disk = statfsSync('/');
  const freeDiskGb = (disk.bavail * disk.bsize) / 1e9;
  console.log(`Catalogue ${basename(catalogPath)}: ${catalog.length} items · cases ${basename(casesPath)}: ${cases.length} (sha ${casesHash})`);
  // macOS counts cached memory as used, so "free" RAM looks near zero; watch Memory Pressure in Activity Monitor instead.
  console.log(`RAM ${(totalmem() / 1e9).toFixed(1)} GB total · disk free ${freeDiskGb.toFixed(1)} GB`);
  if (freeDiskGb < 8) console.warn('! Under 8 GB of free disk: the default model (4.3 GB download) plus Ollama and swap may not fit.');

  const ctx = makeCtx(catalog, {
    k: args.k ? Number(args.k) : undefined,
    minScore: args['min-score'] ? Number(args['min-score']) : undefined,
    minMargin: args['min-margin'] ? Number(args['min-margin']) : undefined,
    llm: { url, model, think: Boolean(args.think), numCtx: args.ctx ? Number(args.ctx) : 2048 },
  });

  let runnable = methods;
  if (methods.some((m) => m.startsWith('llm') || m === 'hybrid')) {
    const models = await availableModels(url);
    if (models === null) {
      console.warn(`! Ollama is not reachable at ${url}; skipping model methods. Start it with: ollama serve`);
      runnable = methods.filter((m) => !m.startsWith('llm') && m !== 'hybrid');
    } else if (!models.includes(model)) {
      console.warn(`! Model "${model}" is not pulled; skipping model methods. Pulled: ${models.join(', ') || 'none'}`);
      console.warn(`  To pull it (check disk first): ollama pull ${model}`);
      runnable = methods.filter((m) => !m.startsWith('llm') && m !== 'hybrid');
    }
    if (runnable.includes('llm-full') && catalog.length > ctx.fullCatalogLimit) {
      console.warn(`! llm-full skipped: ${catalog.length} items exceed the ${ctx.fullCatalogLimit}-item prompt limit.`);
      runnable = runnable.filter((m) => m !== 'llm-full');
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const summaryPath = `${outDir}/summary.md`;
  ensureDir(summaryPath);
  const header =
    '| when | label | method | model | cases | n | auto-accept acc | dangerous | zero typing | suggestion acc | flag recall | review load | SKU acc | recall@k | model calls | valid JSON | p50 ms | p95 ms |\n' +
    '|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n';
  const existing = existsSync(summaryPath) ? readFileSync(summaryPath, 'utf8') : '';
  if (!existing.includes(header)) appendFileSync(summaryPath, `${existing ? '\n' : ''}${header}`);

  for (const method of runnable) {
    const rows: Scored[] = [];
    for (const c of cases) {
      const r = await run(method, c.text, ctx);
      rows.push(scoreCase(c, r));
      if (method.startsWith('llm') || method === 'hybrid') process.stdout.write('.');
    }
    if (method.startsWith('llm') || method === 'hybrid') process.stdout.write('\n');
    const s = summarise(rows);
    const usesModel = method.startsWith('llm') || method === 'hybrid';
    const loaded = usesModel ? await loadedModels(url) : [];

    console.log(`\n== ${method}${usesModel ? ` · ${model}` : ''} ==`);
    console.log(`auto-accept accuracy ${fmt(s.autoAcceptAccuracy)} (${s.autoCorrect}/${s.goldOk})   dangerous ${fmt(s.dangerousRate)} (${s.autoWrong} wrong + ${s.missedFlag} missed flags)`);
    console.log(`flag recall ${fmt(s.flagRecall)} (${s.flaggedCorrectly}/${s.goldReview})   review load ${fmt(s.reviewLoad)}   SKU acc ${fmt(s.skuAccuracy)}   recall@${ctx.k} ${fmt(s.recallAtK)}`);
    console.log(`zero typing ${fmt(s.zeroTyping)} (${s.autoCorrect} auto + ${s.oneTap} one-tap of ${s.goldOk})   suggestion acc ${fmt(s.suggestionAccuracy)}   model calls ${s.modelCalls}`);
    if (usesModel) {
      console.log(`valid JSON first try ${fmt(s.validJsonFirstTry)}   model errors ${s.modelErrors}   latency p50 ${fmt(s.p50ms === null ? null : Math.round(s.p50ms), ' ms')} p95 ${fmt(s.p95ms === null ? null : Math.round(s.p95ms), ' ms')}`);
      for (const m of loaded) console.log(`loaded: ${m.name} ${(m.size / 1e9).toFixed(2)} GB (${(m.size_vram / 1e9).toFixed(2)} GB on GPU)`);
    }
    const bad = rows.filter((r) => r.outcome !== 'auto_correct' && r.outcome !== 'flagged_correctly');
    for (const r of bad.slice(0, Number(args.show ?? 12))) {
      const p = r.result.prediction;
      console.log(`  ${r.outcome.padEnd(18)} ${r.id} "${r.text}" → ${p.sku ?? '∅'} ${p.qty ?? '∅'} ${p.unit ?? '∅'} [${p.reasons.join('; ')}] ask: ${p.question || '–'}  gold ${r.gold.sku ?? '∅'} ${r.gold.qty ?? '∅'} ${r.gold.unit ?? '∅'} ${r.gold.status}`);
    }
    if (bad.length > Number(args.show ?? 12)) console.log(`  … ${bad.length - Number(args.show ?? 12)} more in the results file`);

    const file = writeNew(
      `${outDir}/${stamp}_${method}${usesModel ? `_${model.replace(/[^a-z0-9.]+/gi, '-')}` : ''}`,
      JSON.stringify(
        {
          method,
          model: usesModel ? model : null,
          label,
          catalog: catalogPath,
          cases: casesPath,
          casesSha: casesHash,
          settings: { k: ctx.k, minScore: ctx.minScore, minMargin: ctx.minMargin, numCtx: ctx.llm.numCtx, think: ctx.llm.think },
          machine: { freeRamGb: freemem() / 1e9, freeDiskGb, loaded },
          summary: s,
          byTag: byTag(rows),
          rows,
        },
        null,
        2,
      ),
    );
    appendFileSync(
      summaryPath,
      `| ${stamp} | ${label} | ${method} | ${usesModel ? model : '–'} | ${basename(casesPath)}@${casesHash} | ${s.n} | ${fmt(s.autoAcceptAccuracy)} | ${fmt(s.dangerousRate)} | ${fmt(s.zeroTyping)} | ${fmt(s.suggestionAccuracy)} | ${fmt(s.flagRecall)} | ${fmt(s.reviewLoad)} | ${fmt(s.skuAccuracy)} | ${fmt(s.recallAtK)} | ${s.modelCalls} | ${fmt(s.validJsonFirstTry)} | ${fmt(s.p50ms === null ? null : Math.round(s.p50ms), '')} | ${fmt(s.p95ms === null ? null : Math.round(s.p95ms), '')} |\n`,
    );
    console.log(`→ ${file}`);
  }
  console.log(`\nSummary table: ${summaryPath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

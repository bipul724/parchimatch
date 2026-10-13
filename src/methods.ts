import { bySku, numberNamePhrases } from './catalog.ts';
import { decide } from './llm.ts';
import type { LlmConfig } from './llm.ts';
import { buildMessages } from './prompt.ts';
import { exactMatches, retrieve } from './retrieve.ts';
import { parse } from './text.ts';
import type { CatalogItem, MethodResult, Parsed, Proposal } from './types.ts';
import { finalize } from './validate.ts';

export const METHODS = ['exact', 'fuzzy', 'llm-full', 'llm-cand', 'hybrid'] as const;
export type Method = (typeof METHODS)[number];

export interface Ctx {
  catalog: CatalogItem[];
  index: Map<string, CatalogItem>;
  k: number; // candidates shown to the model in llm-cand / hybrid
  minScore: number; // fuzzy: accept the top match only above this score...
  minMargin: number; // ...and this far ahead of the runner-up
  llm: LlmConfig;
  fullCatalogLimit: number; // llm-full is skipped for catalogues bigger than this
}

export function makeCtx(catalog: CatalogItem[], overrides: Partial<Omit<Ctx, 'catalog' | 'index'>> & { llm: LlmConfig }): Ctx {
  const set = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  return { k: 8, minScore: 0.5, minMargin: 0.08, fullCatalogLimit: 80, ...set, llm: overrides.llm, catalog, index: bySku(catalog) };
}

function fromParser(parsed: Parsed, sku: string | null, status: Proposal['status'] = sku ? 'ok' : 'needs_review'): Proposal {
  return { sku, qty: parsed.qty, unit: parsed.unit, status };
}

export async function run(method: Method, text: string, ctx: Ctx): Promise<MethodResult> {
  const parsed = parse(text, { namePhrases: numberNamePhrases(ctx.catalog) });
  const plain = { rawText: text, fromModel: false };

  if (method === 'exact') {
    const hits = exactMatches(parsed, ctx.catalog);
    const sku = hits.length === 1 ? hits[0].sku : null;
    return { prediction: finalize(fromParser(parsed, sku), parsed, ctx.index, plain) };
  }

  const ranked = retrieve(parsed, ctx.catalog, ctx.catalog.length);
  const candidates = ranked.slice(0, ctx.k).map((r) => r.item.sku);

  if (method === 'fuzzy' || method === 'hybrid') {
    const [top, second] = ranked;
    const confident = top && top.score >= ctx.minScore && top.score - (second?.score ?? 0) >= ctx.minMargin;
    const sku = confident ? top.item.sku : null;
    const fuzzy = { prediction: finalize(fromParser(parsed, sku), parsed, ctx.index, plain), candidates };
    // Hybrid: the model is only asked when fuzzy matching could not name the product.
    if (method === 'fuzzy' || sku !== null) return fuzzy;
  }

  const shownRanked = method === 'llm-full' ? ranked : ranked.slice(0, ctx.k);
  const shown = method === 'llm-full' ? ctx.catalog : shownRanked.map((r) => r.item);
  const { proposal, trace } = await decide(ctx.llm, buildMessages(text, shown, parsed));
  const p: Proposal = proposal ? { ...fromParser(parsed, proposal.sku, proposal.status), evidence: proposal.evidence } : fromParser(parsed, null);
  const prediction = finalize(p, parsed, ctx.index, {
    rawText: text,
    fromModel: true,
    allowedSkus: new Set(shown.map((s) => s.sku)),
    textScores: new Map(shownRanked.map((r) => [r.item.sku, r.score])),
    minMargin: ctx.minMargin,
  });
  if (!proposal) prediction.reasons.unshift(trace.error ? `model error: ${trace.error}` : 'model reply was not valid JSON');
  return { prediction, candidates: method === 'llm-full' ? undefined : candidates, llm: trace };
}

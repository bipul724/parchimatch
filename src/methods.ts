import { bySku, numberNamePhrases } from './catalog.ts';
import { decide } from './llm.ts';
import type { LlmConfig } from './llm.ts';
import { buildMessages } from './prompt.ts';
import { exactMatches, retrieve } from './retrieve.ts';
import { parse } from './text.ts';
import type { Span, SpanOptions, Tracer } from './trace.ts';
import type { CatalogItem, MethodResult, Parsed, Prediction, Proposal } from './types.ts';
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

// Spans for opt-in eval tracing (src/trace.ts). Without a tracer (the app), each step just runs: no span, no import.
const silent: Span = { setAttribute() {}, setAttributes() {}, setStatus() {} };
const tool = (name: string, attributes: SpanOptions['attributes'] = {}): SpanOptions => ({
  name: `execute_tool ${name}`,
  op: 'gen_ai.execute_tool',
  attributes: { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': name, ...attributes },
});
const textMessages = (messages: { role: string; content: string }[]) => JSON.stringify(messages.map((m) => ({ role: m.role, parts: [{ type: 'text', content: m.content }] })));
const round = (n: number) => Math.round(n * 1000) / 1000;

function safety(span: Tracer['startSpan'], check: () => Prediction): Prediction {
  return span(tool('safety_rules', { 'gen_ai.tool.description': 'Code checks S1-S16; any failure sends the line to review' }), (s) => {
    const p = check();
    s.setAttributes({ 'gen_ai.tool.call.result': JSON.stringify({ status: p.status, reasons: p.reasons }), 'parchimatch.reasons': JSON.stringify(p.reasons) });
    return p;
  });
}

export async function run(method: Method, text: string, ctx: Ctx, tracer?: Tracer): Promise<MethodResult> {
  const span: Tracer['startSpan'] = tracer ? (o, fn) => tracer.startSpan(o, fn) : (_o, fn) => fn(silent);
  const parsed = parse(text, { namePhrases: numberNamePhrases(ctx.catalog) });
  const plain = { rawText: text, fromModel: false };

  if (method === 'exact') {
    const hits = exactMatches(parsed, ctx.catalog);
    const sku = hits.length === 1 ? hits[0].sku : null;
    return { prediction: safety(span, () => finalize(fromParser(parsed, sku), parsed, ctx.index, plain)) };
  }

  const { ranked, sku } = span(tool('fuzzy_match', { 'gen_ai.tool.call.arguments': JSON.stringify({ product_text: parsed.productText }) }), (s) => {
    const ranked = retrieve(parsed, ctx.catalog, ctx.catalog.length);
    const [top, second] = ranked;
    const lead = top ? top.score - (second?.score ?? 0) : 0;
    const confident = !!top && top.score >= ctx.minScore && lead >= ctx.minMargin;
    s.setAttributes({
      'gen_ai.tool.call.result': JSON.stringify({ top_sku: top?.item.sku ?? null, top_score: top ? round(top.score) : null, lead: round(lead), confident }),
      'parchimatch.top_score': top ? round(top.score) : 0,
      'parchimatch.lead': round(lead),
    });
    return { ranked, sku: (method === 'fuzzy' || method === 'hybrid') && confident ? top.item.sku : null };
  });
  const candidates = ranked.slice(0, ctx.k).map((r) => r.item.sku);

  // Hybrid: the model is only asked when fuzzy matching could not name the product.
  if (method === 'fuzzy' || (method === 'hybrid' && sku !== null)) {
    return { prediction: safety(span, () => finalize(fromParser(parsed, sku), parsed, ctx.index, plain)), candidates };
  }

  const shownRanked = method === 'llm-full' ? ranked : ranked.slice(0, ctx.k);
  const shown = method === 'llm-full' ? ctx.catalog : shownRanked.map((r) => r.item);
  const messages = buildMessages(text, shown, parsed);
  const { proposal, trace } = await span(
    {
      name: `chat ${ctx.llm.model}`,
      op: 'gen_ai.chat',
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'ollama',
        'gen_ai.request.model': ctx.llm.model,
        'gen_ai.request.temperature': 0,
        'gen_ai.system_instructions': messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n'),
        'gen_ai.input.messages': textMessages(messages.filter((m) => m.role !== 'system')),
      },
    },
    async (s) => {
      const out = await decide(ctx.llm, messages);
      s.setAttributes({
        'gen_ai.response.model': ctx.llm.model,
        'gen_ai.output.messages': textMessages([{ role: 'assistant', content: out.trace.raw }]),
        'parchimatch.retries': out.trace.retries,
        ...(out.trace.promptTokens != null ? { 'gen_ai.usage.input_tokens': out.trace.promptTokens } : {}),
        ...(out.trace.outputTokens != null ? { 'gen_ai.usage.output_tokens': out.trace.outputTokens } : {}),
      });
      if (!out.proposal) {
        const status = out.trace.error && /^Ollama (\d+)/.exec(out.trace.error)?.[1];
        s.setStatus({ code: 2, message: 'internal_error' });
        s.setAttribute('error.type', out.trace.error ? (status ? `http_${status}` : 'request_failed') : 'invalid_json');
      }
      return out;
    },
  );
  const p: Proposal = proposal ? { ...fromParser(parsed, proposal.sku, proposal.status), evidence: proposal.evidence } : fromParser(parsed, null);
  const prediction = safety(span, () => {
    const pred = finalize(p, parsed, ctx.index, {
      rawText: text,
      fromModel: true,
      allowedSkus: new Set(shown.map((s) => s.sku)),
      textScores: new Map(shownRanked.map((r) => [r.item.sku, r.score])),
      minMargin: ctx.minMargin,
    });
    if (!proposal) pred.reasons.unshift(trace.error ? `model error: ${trace.error}` : 'model reply was not valid JSON');
    return pred;
  });
  return { prediction, candidates: method === 'llm-full' ? undefined : candidates, llm: trace };
}

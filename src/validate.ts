import { phrases, variantSize } from './catalog.ts';
import { normalize, parse, sameSize } from './text.ts';
import type { CatalogItem, Parsed, Prediction, Proposal, QtyUnit } from './types.ts';

export interface FinalizeOptions {
  rawText: string;
  fromModel: boolean; // model output must agree with the deterministic parser and quote its evidence
  allowedSkus?: Set<string>; // the candidates the decider was shown
  textScores?: Map<string, number>; // fuzzy text score per candidate; a model pick must be the best text match to auto-accept...
  minMargin?: number; // ...by the same margin fuzzy matching needs. The model replaces the score threshold, not the margin.
}

// "maggi 4 pack 1 petti": the 4 belongs to the product name, so the quantity is 1 carton.
export function resolvePairs(parsed: Parsed, item: CatalogItem): QtyUnit | null {
  if (parsed.pairs.length <= 1) return null;
  const namePairs = phrases(item).flatMap((p) => parse(p).pairs);
  const left = parsed.pairs.filter((pr) => !namePairs.some((named) => named.qty === pr.qty && named.unit === pr.unit));
  return left.length === 1 ? left[0] : null;
}

// Every proposal passes through here. Anything that fails a rule goes to the operator, never to the export.
// The operator's question is written here from the failed rule, not by the model: code knows exactly what is missing.
// A rejected product stays on the row as a suggestion the operator can confirm with one tap.
export function finalize(p: Proposal, parsed: Parsed, catalog: Map<string, CatalogItem>, opts: FinalizeOptions): Prediction {
  const reasons: string[] = [];
  const questions: string[] = [];
  const flag = (reason: string, question: string) => {
    reasons.push(reason);
    questions.push(question);
  };
  let { sku, qty, unit } = p;

  if (sku !== null && !catalog.has(sku)) {
    reasons.push(`sku ${sku} is not in the catalogue`);
    sku = null;
  } else if (sku !== null && opts.allowedSkus && !opts.allowedSkus.has(sku)) {
    reasons.push(`sku ${sku} was not among the candidates shown`);
    sku = null;
  }
  const item = sku ? catalog.get(sku) : undefined;
  const label = item ? `${item.name} (${item.variant})` : '';
  const askProduct = item ? `Is it ${label}?` : `Which product is "${parsed.productText || opts.rawText}"?`;

  if (p.status === 'needs_review') flag('decider unsure', askProduct);
  else if (!item) flag('no product chosen', askProduct);

  if (parsed.pairs.length > 1) {
    const r = item ? resolvePairs(parsed, item) : null;
    // Only code can resolve multiple written pairs; a proposal cannot bypass S7.
    qty = r?.qty ?? null;
    unit = r?.unit ?? null;
  }

  if (item) {
    if (parsed.priceHints?.some((hint) => hint !== parsed.priceHint)) flag('conflicting price hints in the order', 'Which price?');
    if (parsed.sizeHint && parsed.sizeHints?.some((hint) => !sameSize(hint, parsed.sizeHint!))) flag('conflicting pack size hints in the order', 'Which pack size?');
    if (parsed.priceHint !== null && item.mrp !== null && item.mrp !== parsed.priceHint) flag(`order says ₹${parsed.priceHint} but ${item.sku} is ₹${item.mrp}`, `Which ₹${parsed.priceHint} item?`);
    const vs = variantSize(item);
    if (parsed.sizeHint && !vs) flag(`catalogue pack size is unknown for ${item.sku} (${item.variant})`, `Which ${parsed.sizeHint.value} ${parsed.sizeHint.dim} item?`);
    if (parsed.sizeHint && vs && !sameSize(parsed.sizeHint, vs)) flag(`order pack size differs from ${item.sku} (${item.variant})`, `Which ${parsed.sizeHint.value} ${parsed.sizeHint.dim} item?`);
  }

  if (opts.fromModel) {
    if (parsed.pairs.length <= 1) {
      if (parsed.qty !== null && qty !== parsed.qty) flag(`quantity ${qty} differs from order text (${parsed.qty})`, `Is it ${parsed.qty}?`);
      if (parsed.unit !== null && unit !== parsed.unit) flag(`unit ${unit} differs from order text (${parsed.unit})`, `Is it ${parsed.unit}?`);
      if (parsed.qty === null && qty !== null) flag(`quantity ${qty} was not read as an order quantity`, 'How many?');
    }
    const ev = normalize(p.evidence ?? '').split(' ').filter(Boolean);
    if (p.status === 'ok' && (ev.length === 0 || !ev.every((w) => parsed.tokens.includes(w)))) flag('evidence is not quoted from the order', askProduct);
    // The model may confirm the best text match, but may not overrule the order's own words by itself.
    if (item && p.status === 'ok' && opts.textScores) {
      const mine = opts.textScores.get(item.sku) ?? -Infinity;
      const rival = [...opts.textScores].filter(([s]) => s !== item.sku).sort((a, b) => b[1] - a[1])[0];
      if (rival && rival[1] >= mine - (opts.minMargin ?? 0)) flag(`order words fit ${rival[0]} about as well as ${item.sku}`, askProduct);
    }
  }

  if (qty === null) flag('quantity missing', parsed.pairs.length > 1 ? `Which quantity: ${parsed.pairs.map((pr) => `${pr.qty} ${pr.unit}`).join(' or ')}?` : 'How many?');
  else if (!Number.isInteger(qty) || qty <= 0 || qty > 10000) flag(`implausible quantity ${qty}`, `Is ${qty} correct?`);

  if (item) {
    if (parsed.unknownUnit) flag(`unit word "${parsed.unknownUnit}" not recognised`, `What is "${parsed.unknownUnit}"? ${item.sellUnits.join(' or ')}?`);
    if (unit === null && !parsed.unknownUnit) {
      if (item.sellUnits.length === 1) unit = item.sellUnits[0];
      else flag(`unit missing; ${item.sku} is sold by ${item.sellUnits.join('/')}`, `${item.sellUnits.join(' or ')}?`);
    } else if (unit !== null && !item.sellUnits.includes(unit)) flag(`${item.sku} is not sold by ${unit}`, `${label} is sold by ${item.sellUnits.join('/')}. Which one?`);
    if (unit === 'carton' && item.unitsPerCarton === null) flag(`units per carton unknown for ${item.sku}`, `How many in one carton of ${item.name} ${item.variant}?`);
  }

  return {
    sku,
    qty,
    unit,
    status: reasons.length ? 'needs_review' : 'ok',
    reasons,
    evidence: p.evidence,
    question: questions[0] ?? '',
  };
}

// Base units for the export file, e.g. 2 cartons x 144 = 288 packets. Only called on validated rows.
export function baseQuantity(pred: Prediction, item: CatalogItem): number | null {
  if (pred.qty === null || pred.unit === null) return null;
  if (pred.unit === 'carton') return item.unitsPerCarton === null ? null : pred.qty * item.unitsPerCarton;
  if (pred.unit === 'dozen') return pred.qty * 12;
  return pred.qty;
}

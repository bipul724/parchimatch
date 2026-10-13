import { run } from './methods.ts';
import type { Ctx } from './methods.ts';
import { numberNamePhrases, variantSize } from './catalog.ts';
import { exactMatches, retrieve } from './retrieve.ts';
import { parse, sameSize } from './text.ts';
import { UNITS } from './types.ts';
import type { CatalogItem, Prediction, Unit } from './types.ts';
import { baseQuantity, finalize } from './validate.ts';

// One row of the review screen: the pipeline's answer plus what the operator needs to fix it.

export interface Candidate {
  sku: string;
  label: string;
}

export interface Row {
  line: number;
  text: string;
  kind: 'item' | 'note'; // notes are greetings/closings; shown greyed, never exported
  source: 'learned' | 'fuzzy' | 'model' | 'none';
  status: Prediction['status'];
  sku: string | null; // accepted product, or the suggestion when status is needs_review
  qty: number | null;
  unit: Unit | null;
  reasons: string[];
  question: string;
  productText: string; // what "remember this name" would save
  nameKnown: boolean; // the catalogue already knows this name; the problem is the variant or quantity, so nothing to learn
  candidates: Candidate[];
  ms: number | null; // model time for this line
  baseQty: number | null; // what the export's base_qty will be ("2 carton" → 288); null if unknown, e.g. carton size missing
  baseUnit: string | null; // the unit baseQty counts ("packet"); null without a product and unit
}

export function itemLabel(item: CatalogItem): string {
  return `${item.name} · ${item.variant}${item.mrp === null ? '' : ` · ₹${item.mrp}`}`;
}

// True when the order's product words already match a catalogue name or alias (e.g. "tata tea premium").
export function nameIsKnown(productText: string, catalog: CatalogItem[]): boolean {
  return exactMatches(parse(productText, { namePhrases: numberNamePhrases(catalog) }), catalog).length > 0;
}

// A learned name means the product (every variant with the same catalogue name), not one pack size.
// Price and size written in the order still pick the variant; if they can't, the operator is asked.
function learnedVariant(learnedSku: string, parsed: ReturnType<typeof parse>, ctx: Ctx): { sku: string; status: Prediction['status'] } {
  const learnedItem = ctx.index.get(learnedSku)!;
  let family = ctx.catalog.filter((c) => c.name === learnedItem.name);
  if (parsed.priceHint !== null) family = family.filter((c) => c.mrp === null || c.mrp === parsed.priceHint);
  if (parsed.sizeHint) {
    const size = parsed.sizeHint;
    family = family.filter((c) => {
      const vs = variantSize(c);
      return !vs || sameSize(vs, size);
    });
  }
  if (family.length === 1) return { sku: family[0].sku, status: 'ok' };
  return { sku: family.some((c) => c.sku === learnedSku) ? learnedSku : (family[0]?.sku ?? learnedSku), status: 'needs_review' };
}

export async function matchLine(line: number, text: string, ctx: Ctx, learned: Map<string, string>, useModel: boolean, forceItem = false): Promise<Row> {
  const parsed = parse(text, { namePhrases: numberNamePhrases(ctx.catalog) });
  const ranked = retrieve(parsed, ctx.catalog, 5);
  const savedSku = learned.get(parsed.productText);
  const learnedSku = savedSku && ctx.index.has(savedSku) ? savedSku : undefined;
  const base = { line, text, productText: parsed.productText, nameKnown: nameIsKnown(parsed.productText, ctx.catalog) };

  // "Ram Ram bhaiya", "Total bata dena": no number and nothing in the catalogue resembles it.
  if (!forceItem && !learnedSku && !parsed.pairs.length && parsed.unit === null && !parsed.tokens.some((token) => /[0-9]/.test(token)) && (ranked[0]?.score ?? 0) < 0.3) {
    return { ...base, kind: 'note', source: 'none', status: 'needs_review', sku: null, qty: null, unit: null, reasons: ['looks like a note, not an item'], question: '', candidates: [], ms: null, baseQty: null, baseUnit: null };
  }

  let prediction: Prediction;
  let source: Row['source'];
  let ms: number | null = null;
  if (learnedSku) {
    const pick = learnedVariant(learnedSku, parsed, ctx);
    prediction = finalize({ sku: pick.sku, qty: parsed.qty, unit: parsed.unit, status: pick.status }, parsed, ctx.index, { rawText: text, fromModel: false });
    source = 'learned';
  } else {
    const r = await run(useModel ? 'hybrid' : 'fuzzy', text, ctx);
    prediction = r.prediction;
    source = r.llm ? 'model' : prediction.sku ? 'fuzzy' : 'none';
    ms = r.llm ? Math.round(r.llm.ms) : null;
  }

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const sku of [prediction.sku, ...ranked.map((r) => r.item.sku)]) {
    const item = sku ? ctx.index.get(sku) : undefined;
    if (item && !seen.has(item.sku)) {
      seen.add(item.sku);
      candidates.push({ sku: item.sku, label: itemLabel(item) });
    }
  }
  const item = prediction.sku ? ctx.index.get(prediction.sku) : undefined;
  return {
    ...base,
    kind: 'item',
    source,
    status: prediction.status,
    sku: prediction.sku,
    qty: prediction.qty,
    unit: prediction.unit,
    reasons: prediction.reasons,
    question: prediction.question ?? '',
    candidates,
    ms,
    baseQty: item ? baseQuantity(prediction, item) : null,
    baseUnit: item && prediction.unit ? baseUnit(item, prediction.unit) : null,
  };
}

export interface ConfirmedRow {
  line: number;
  text: string;
  status: 'confirmed' | 'skipped';
  sku: string | null;
  qty: number | null;
  unit: Unit | null;
  note?: string;
}

// The unit a carton or dozen breaks into, for the base-quantity column.
export function baseUnit(item: CatalogItem, unit: Unit): string {
  if (unit === 'dozen') return 'piece';
  if (unit === 'carton') return item.sellUnits.find((u) => u !== 'carton' && u !== 'dozen') ?? 'unit';
  return unit;
}

// Server-side check of what the operator confirmed. Returns an error per bad row.
export function checkConfirmed(rows: ConfirmedRow[], index: Map<string, CatalogItem>): string[] {
  const errors: string[] = [];
  for (const r of rows) {
    if (r.status !== 'confirmed') continue;
    const item = r.sku ? index.get(r.sku) : undefined;
    if (!item) errors.push(`line ${r.line}: unknown product ${r.sku}`);
    else if (r.unit === null || !(UNITS as readonly string[]).includes(r.unit) || !item.sellUnits.includes(r.unit)) errors.push(`line ${r.line}: ${item.sku} is not sold by ${r.unit}`);
    if (r.qty === null || !Number.isInteger(r.qty) || r.qty <= 0 || r.qty > 10000) errors.push(`line ${r.line}: quantity ${r.qty} is not valid`);
  }
  return errors;
}

export function exportCsv(rows: ConfirmedRow[], index: Map<string, CatalogItem>): string {
  const q = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    // Spreadsheet readers can interpret these prefixes as formulas, even after whitespace.
    if (/^\s*[=+@-]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out = ['line_no,order_text,sku,name,variant,qty,unit,base_qty,base_unit,status,reviewer_note'];
  for (const r of rows) {
    const item = r.sku ? index.get(r.sku) : undefined;
    let base: number | null = null;
    let note = r.note ?? '';
    if (item && r.status === 'confirmed' && r.unit) {
      base = baseQuantity({ sku: r.sku, qty: r.qty, unit: r.unit, status: 'ok', reasons: [] }, item);
      if (base === null && r.unit === 'carton') note = [note, 'carton size unknown: base quantity left blank'].filter(Boolean).join('; ');
    }
    out.push(
      [r.line, r.text, r.status === 'confirmed' ? r.sku : '', item && r.status === 'confirmed' ? item.name : '', item && r.status === 'confirmed' ? item.variant : '', r.status === 'confirmed' ? r.qty : '', r.status === 'confirmed' ? r.unit : '', base, item && r.status === 'confirmed' && r.unit ? baseUnit(item, r.unit) : '', r.status, note]
        .map(q)
        .join(','),
    );
  }
  return out.join('\n') + '\n';
}

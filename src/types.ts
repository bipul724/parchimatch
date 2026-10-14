// Order units a shop sells in. Pack sizes (kg, g, litre, ml) are product variants, never order units.
export const UNITS = ['piece', 'packet', 'carton', 'dozen', 'bag'] as const;
export type Unit = (typeof UNITS)[number];

export type Status = 'ok' | 'needs_review';

export interface CatalogItem {
  sku: string;
  name: string;
  brand: string;
  variant: string;
  mrp: number | null;
  sellUnits: Unit[];
  unitsPerCarton: number | null;
  aliases: string[];
}

export interface Size {
  value: number; // normalised to grams or millilitres
  dim: 'g' | 'ml';
}

export interface QtyUnit {
  qty: number;
  unit: Unit;
}

export interface Parsed {
  tokens: string[];
  productText: string;
  qty: number | null;
  unit: Unit | null;
  pairs: QtyUnit[]; // every number+unit pair found; >1 distinct pairs means the line is ambiguous
  priceHint: number | null; // "5/-", "10 wala", "rs 20"
  sizeHint: Size | null; // "1 kg", "250 gm", "5 litre"
  priceHints?: number[]; // every explicit price, so contradictory hints cannot be silently discarded
  sizeHints?: Size[]; // every explicit size, including its dimension
  unknownUnit?: string | null; // word after a bare quantity that isn't a known unit ("10 jodi")
  unclearNumber?: string | null; // digit-comma-digit that isn't a well-formed grouping ("1,5", "2,50"); never read as a number (S16)
}

export interface Gold {
  sku: string | null;
  qty: number | null;
  unit: Unit | null;
  status: Status;
  question?: string;
}

export interface Case {
  id: string;
  text: string;
  gold: Gold;
  tags: string[];
}

// What the model returns: only the product. Its sku is a best guess even when status is needs_review,
// so the operator can confirm it with one tap.
export interface ModelChoice {
  sku: string | null;
  status: Status;
  evidence: string;
}

// What a method proposes before code validation.
export interface Proposal {
  sku: string | null;
  qty: number | null;
  unit: Unit | null;
  status: Status;
  evidence?: string;
  question?: string;
}

export interface Prediction extends Proposal {
  reasons: string[]; // why it needs review; empty when status is ok
}

export interface LlmTrace {
  ms: number;
  validFirstTry: boolean;
  retries: number;
  raw: string;
  error?: string;
  promptTokens?: number | null; // Ollama prompt_eval_count, summed over the repair retry; null if Ollama sent none
  outputTokens?: number | null; // Ollama eval_count, likewise
}

export interface MethodResult {
  prediction: Prediction;
  candidates?: string[]; // SKUs shown to the decider, in rank order
  llm?: LlmTrace;
}

import { describe } from './catalog.ts';
import type { CatalogItem, ModelChoice, Parsed } from './types.ts';

// Shared by inference and by training-data export, so a fine-tuned model sees exactly the prompt it was trained on.
// The model only identifies the product. Quantity, unit, price and size are read by code.

export const SYSTEM_PROMPT = `You identify which catalogue product ONE line of an Indian wholesale order refers to.

The line may use Hinglish or Hindi words, misspellings, brand-only names, pack colours, or a price ("5 wala", "10 rs", "5/-") meaning the ₹5 or ₹10 pack.
Quantity and unit are handled by code; ignore them.

Rules:
- sku: your best guess, ONLY from the candidate list. Use "" if no candidate is plausible.
- status: "ok" if the order clearly means that product; "needs_review" if another candidate could also fit or you are guessing.
- evidence: the exact words from the order line that name the product.
Reply with JSON only.`;

export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    evidence: { type: 'string' },
    sku: { type: 'string' },
    status: { type: 'string', enum: ['ok', 'needs_review'] },
  },
  required: ['evidence', 'sku', 'status'],
  additionalProperties: false,
} as const;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function hints(parsed: Parsed): string {
  const h: string[] = [];
  if (parsed.priceHint !== null) h.push(`Price written in the order: ₹${parsed.priceHint}`);
  if (parsed.sizeHint) h.push(`Pack size written in the order: ${parsed.sizeHint.value} ${parsed.sizeHint.dim}`);
  return h.length ? `\n${h.join('\n')}` : '';
}

export function buildMessages(orderLine: string, candidates: CatalogItem[], parsed: Parsed): ChatMessage[] {
  const list = candidates.map((c) => `- ${describe(c)}`).join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Order line: ${JSON.stringify(orderLine)}${hints(parsed)}\n\nCandidates:\n${list}` },
  ];
}

// Model JSON -> ModelChoice. Returns null when the shape is wrong, so the caller can retry or abstain.
export function parseModelOutput(raw: string): ModelChoice | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object') return null;
  const { evidence, sku, status } = j;
  if (typeof sku !== 'string' || typeof evidence !== 'string') return null;
  if (status !== 'ok' && status !== 'needs_review') return null;
  return { sku: sku.trim() === '' ? null : sku.trim(), status, evidence };
}

export function targetJson(t: ModelChoice): string {
  return JSON.stringify({ evidence: t.evidence, sku: t.sku ?? '', status: t.status });
}

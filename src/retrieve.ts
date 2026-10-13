import { phrases, variantSize } from './catalog.ts';
import { sameSize } from './text.ts';
import type { CatalogItem, Parsed } from './types.ts';

function trigrams(s: string): Set<string> {
  const p = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const triCache = new Map<string, Set<string>>();
function tri(s: string): Set<string> {
  let t = triCache.get(s);
  if (!t) {
    t = trigrams(s);
    triCache.set(s, t);
  }
  return t;
}

// Share of query words that resemble some word of the phrase (handles "kurkre" ~ "kurkure").
function wordCover(query: string, phrase: string): number {
  const q = query.split(' ');
  const p = phrase.split(' ');
  const hit = q.filter((w) => p.some((x) => x === w || jaccard(tri(w), tri(x)) >= 0.4)).length;
  return hit / q.length;
}

// Whole-line similarity, used to catch near-duplicates between training data and the test set.
export function textSimilarity(a: string, b: string): number {
  return jaccard(tri(a), tri(b));
}

export function score(parsed: Parsed, item: CatalogItem): number {
  const q = parsed.productText;
  if (!q) return 0;
  let best = 0;
  for (const ph of phrases(item)) best = Math.max(best, 0.6 * jaccard(tri(q), tri(ph)) + 0.4 * wordCover(q, ph));
  if (parsed.priceHint !== null && item.mrp !== null) best += item.mrp === parsed.priceHint ? 0.15 : -0.15;
  const vs = variantSize(item);
  if (parsed.sizeHint && vs) best += sameSize(parsed.sizeHint, vs) ? 0.15 : -0.15;
  return best;
}

export interface Scored {
  item: CatalogItem;
  score: number;
}

export function retrieve(parsed: Parsed, catalog: CatalogItem[], k: number): Scored[] {
  return catalog
    .map((item) => ({ item, score: score(parsed, item) }))
    .sort((a, b) => b.score - a.score || a.item.sku.localeCompare(b.item.sku))
    .slice(0, k);
}

// Longest catalogue phrase that appears word-for-word in the order, narrowed by price and size hints.
export function exactMatches(parsed: Parsed, catalog: CatalogItem[]): CatalogItem[] {
  const q = ` ${parsed.productText} `;
  let bestLen = 0;
  let hits: CatalogItem[] = [];
  for (const item of catalog) {
    for (const ph of phrases(item)) {
      if (!q.includes(` ${ph} `)) continue;
      if (ph.length > bestLen) {
        bestLen = ph.length;
        hits = [item];
      } else if (ph.length === bestLen && !hits.includes(item)) hits.push(item);
    }
  }
  if (parsed.priceHint !== null) hits = hits.filter((i) => i.mrp === null || i.mrp === parsed.priceHint);
  if (parsed.sizeHint) {
    const size = parsed.sizeHint;
    hits = hits.filter((i) => {
      const vs = variantSize(i);
      return !vs || sameSize(vs, size);
    });
  }
  return hits;
}

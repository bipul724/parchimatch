import { readFileSync } from 'node:fs';
import { findSize, normalize, UNIT_WORDS } from './text.ts';
import { UNITS } from './types.ts';
import type { CatalogItem, Size, Unit } from './types.ts';
import { parseCsv } from './util.ts';

// Catalogue CSV columns: sku,name,brand,variant,mrp,sell_units,units_per_carton,aliases
// sell_units and aliases are "|"-separated. Empty mrp / units_per_carton means unknown.
export function loadCatalog(path: string): CatalogItem[] {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const seen = new Set<string>();
  const errors: string[] = [];
  // A header-only upload would otherwise replace a working catalogue with an empty one.
  if (rows.length === 0) errors.push('catalogue has no items');
  const items = rows.map((r, i) => {
    const line = i + 2;
    const sku = r.sku;
    if (!sku) errors.push(`row ${line}: missing sku`);
    if (!r.name) errors.push(`row ${line}: missing name`);
    if (seen.has(sku)) errors.push(`row ${line}: duplicate sku ${sku}`);
    seen.add(sku);
    const sellUnits = (r.sell_units || '').split('|').map((u) => u.trim()).filter(Boolean);
    for (const u of sellUnits) if (!(UNITS as readonly string[]).includes(u)) errors.push(`row ${line}: unknown unit "${u}"`);
    if (sellUnits.length === 0) errors.push(`row ${line}: sell_units is empty`);
    const mrp = r.mrp ? Number(r.mrp) : null;
    if (mrp !== null && !Number.isFinite(mrp)) errors.push(`row ${line}: mrp "${r.mrp}" is not a number`);
    const upc = r.units_per_carton ? Number(r.units_per_carton) : null;
    if (upc !== null && !(Number.isInteger(upc) && upc > 0)) errors.push(`row ${line}: units_per_carton "${r.units_per_carton}" is not a positive integer`);
    return {
      sku,
      name: r.name,
      brand: r.brand,
      variant: r.variant,
      mrp,
      sellUnits: sellUnits as Unit[],
      unitsPerCarton: upc,
      aliases: (r.aliases || '').split('|').map((a) => a.trim()).filter(Boolean),
    };
  });
  if (errors.length) throw new Error(`Catalogue ${path} has problems:\n  ${errors.join('\n  ')}`);
  return items;
}

const phraseCache = new WeakMap<CatalogItem, string[]>();
export function phrases(item: CatalogItem): string[] {
  let p = phraseCache.get(item);
  if (!p) {
    p = [...new Set([item.name, ...item.aliases].map(normalize).filter(Boolean))];
    phraseCache.set(item, p);
  }
  return p;
}

const sizeCache = new WeakMap<CatalogItem, Size | null>();
export function variantSize(item: CatalogItem): Size | null {
  if (!sizeCache.has(item)) sizeCache.set(item, findSize(item.variant));
  return sizeCache.get(item) ?? null;
}

export function bySku(catalog: CatalogItem[]): Map<string, CatalogItem> {
  return new Map(catalog.map((c) => [c.sku, c]));
}

// One line per candidate in the model prompt. Units per carton is left out on purpose: code converts.
export function describe(item: CatalogItem): string {
  const mrp = item.mrp === null ? 'MRP unknown' : `MRP ₹${item.mrp}`;
  return `sku=${item.sku} | ${item.name} (${item.brand}) | ${item.variant} | ${mrp} | sold by: ${item.sellUnits.join(', ')}`;
}

// "<number> <word>" pairs inside catalogue names and aliases ("5 star"), excluding unit words ("4 pack" is a
// quantity-looking pair handled by resolvePairs). parse() keeps these as product words instead of reading the
// number as a quantity and the word as an unknown unit.
const namePhraseCache = new WeakMap<CatalogItem[], Set<string>>();
export function numberNamePhrases(catalog: CatalogItem[]): Set<string> {
  let set = namePhraseCache.get(catalog);
  if (!set) {
    set = new Set<string>();
    for (const item of catalog) {
      for (const phrase of phrases(item)) {
        const t = phrase.split(' ');
        for (let i = 0; i + 1 < t.length; i++) if (/^\d+$/.test(t[i]) && !UNIT_WORDS[t[i + 1]] && /^[a-zऀ-ॿ]+$/.test(t[i + 1])) set.add(`${t[i]} ${t[i + 1]}`);
      }
    }
    namePhraseCache.set(catalog, set);
  }
  return set;
}

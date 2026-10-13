import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { normalize } from './text.ts';
import type { CatalogItem } from './types.ts';
import { ensureDir, parseCsv } from './util.ts';

// Names the operator taught the app ("lays hara" -> LAYSCRM-10). Plain CSV next to the shop's data: alias,sku,created
// This is learning from corrections without any model training.

export function loadLearned(path: string, index: Map<string, CatalogItem>): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(path)) return map;
  for (const r of parseCsv(readFileSync(path, 'utf8'))) {
    const alias = normalize(r.alias ?? '');
    if (alias && index.has(r.sku)) map.set(alias, r.sku);
  }
  return map;
}

// Returns true when a new mapping was saved. Later entries win, so a correction can be corrected.
export function addLearned(path: string, map: Map<string, string>, alias: string, sku: string): boolean {
  const key = normalize(alias);
  if (!key || map.get(key) === sku) return false;
  ensureDir(path);
  if (!existsSync(path)) writeFileSync(path, 'alias,sku,created\n');
  const safe = key.includes(',') || key.includes('"') ? `"${key.replace(/"/g, '""')}"` : key;
  appendFileSync(path, `${safe},${sku},${new Date().toISOString()}\n`);
  map.set(key, sku);
  return true;
}

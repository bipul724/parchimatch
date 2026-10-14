import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushRow = () => {
    row.push(field);
    field = '';
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else field += c;
  }
  pushRow();
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, j) => [h.trim(), (r[j] ?? '').trim()])));
}

export function readJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => line !== '' && !line.startsWith('//'))
    .map(({ line, n }) => {
      try {
        return JSON.parse(line) as T;
      } catch (e) {
        throw new Error(`${path}:${n}: invalid JSON (${(e as Error).message})`);
      }
    });
}

export function writeJsonl(path: string, rows: unknown[]): void {
  ensureDir(path);
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

export function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// Deterministic PRNG so splits are reproducible from a seed.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A value flag written without a value parses as `true`, and String(true) became the file "true".
// Returns the first such flag's message ("--catalog needs a value, e.g. …"), or null.
export function missingValue(args: Record<string, string | boolean>, examples: Record<string, string>): string | null {
  for (const [flag, example] of Object.entries(examples)) {
    if (args[flag] === true || args[flag] === '') return `--${flag} needs a value, e.g. --${flag} ${example}`;
  }
  return null;
}

// Plain words for a file error ("no such file"), instead of "ENOENT: no such file or directory, open '…'".
export function fileProblem(e: unknown): string {
  const code = (e as { code?: string }).code;
  if (code === 'ENOENT') return 'no such file';
  if (code === 'EISDIR') return "it's a folder, not a file";
  if (code === 'EACCES' || code === 'EPERM') return 'permission denied';
  return e instanceof Error ? e.message : String(e);
}

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

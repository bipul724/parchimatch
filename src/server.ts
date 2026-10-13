import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bySku, loadCatalog, numberNamePhrases } from './catalog.ts';
import { addLearned, loadLearned } from './learned.ts';
import { availableModels } from './llm.ts';
import { makeCtx } from './methods.ts';
import type { Ctx } from './methods.ts';
import { splitOrder } from './orderlines.ts';
import { checkConfirmed, exportCsv, itemLabel, matchLine, nameIsKnown } from './review.ts';
import type { ConfirmedRow } from './review.ts';
import type { CatalogItem } from './types.ts';
import { normalize, parse } from './text.ts';
import { ensureDir, parseArgs } from './util.ts';

// Local review app. Binds to 127.0.0.1 only; nothing leaves the machine except calls to the local Ollama.
// Usage: npm start [-- --catalog data/synthetic/catalog.csv] [--port 5178] [--data data/app] [--model gemma4:e2b-it-qat]

const args = parseArgs(process.argv.slice(2));
const root = resolve(import.meta.dirname, '..');
const port = Number(args.port ?? 5178);
const dataDir = resolve(root, String(args.data ?? 'data/app'));
const samplesDir = resolve(root, String(args.samples ?? 'data/synthetic/orders'));
const learnedPath = join(dataDir, 'aliases_learned.csv');
const model = String(args.model ?? 'gemma4:e2b-it-qat');
const ollamaUrl = String(args.url ?? 'http://127.0.0.1:11434');

// An explicit --catalog always wins. Otherwise reuse a catalogue uploaded in the app, which is saved to
// <data>/catalog.csv: restarting used to silently bring back the synthetic catalogue (HTTP-08).
function startupCatalog(): { path: string; items: CatalogItem[]; why: string } {
  if (args.catalog !== undefined) {
    const path = resolve(root, String(args.catalog));
    return { path, items: loadCatalog(path), why: '--catalog' };
  }
  const uploaded = join(dataDir, 'catalog.csv');
  let why = 'default: no --catalog and nothing uploaded';
  if (existsSync(uploaded)) {
    try {
      const items = loadCatalog(uploaded);
      if (items.length) return { path: uploaded, items, why: 'uploaded in the app' };
      throw new Error('it has no items');
    } catch (e) {
      console.warn(`warning: saved catalogue ${uploaded} can't be used, loading the default instead.\n${(e as Error).message}`);
      why = 'default: saved upload unusable';
    }
  }
  const path = resolve(root, 'data/synthetic/catalog.csv');
  return { path, items: loadCatalog(path), why };
}

const startup = startupCatalog();
let catalogPath = startup.path;
let catalog: CatalogItem[] = startup.items;
let ctx: Ctx = makeCtx(catalog, { llm: { url: ollamaUrl, model, think: false, numCtx: 2048 } });
let learned = loadLearned(learnedPath, ctx.index);
let activeMatch: AbortController | null = null;

async function modelReady(signal?: AbortSignal): Promise<boolean> {
  const models = await availableModels(ollamaUrl, signal);
  return !!models?.includes(model);
}

const STATIC: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage, limit = 1_000_000): Promise<T> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    // Drain an oversized body without retaining it or destroying a reusable HTTP connection.
    if (size <= limit) chunks.push(c as Buffer);
  }
  if (size > limit) throw new HttpError(413, 'request too large');
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'invalid JSON'); }
  if (!isObject(value)) throw new HttpError(400, 'request body must be a JSON object');
  return value as T;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      return send(res, 200, readFileSync(join(root, 'app', file), 'utf8'), type);
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      return send(res, 200, { catalog: catalogPath.replace(`${root}/`, ''), items: catalog.length, learned: learned.size, model, modelReady: await modelReady() });
    }

    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      return send(res, 200, catalog.map((c) => ({ sku: c.sku, label: itemLabel(c), units: c.sellUnits, unitsPerCarton: c.unitsPerCarton })));
    }

    if (req.method === 'POST' && url.pathname === '/api/catalog') {
      // Replace the catalogue with an uploaded CSV. Validation errors come back by row; nothing is replaced on error.
      const { csv } = await readJson<{ csv: string }>(req, 5_000_000);
      if (typeof csv !== 'string') throw new HttpError(400, 'csv must be a string');
      const path = join(dataDir, 'catalog.csv');
      const tmp = `${path}.upload`;
      ensureDir(tmp);
      writeFileSync(tmp, csv);
      try {
        const next = loadCatalog(tmp);
        writeFileSync(path, csv);
        catalogPath = path;
        catalog = next;
        ctx = makeCtx(catalog, { llm: ctx.llm });
        learned = loadLearned(learnedPath, bySku(catalog));
        return send(res, 200, { ok: true, items: catalog.length });
      } catch (e) {
        return send(res, 400, { ok: false, error: (e as Error).message });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/samples') {
      const files = existsSync(samplesDir) ? readdirSync(samplesDir).filter((f) => /^[\w-]+\.txt$/.test(f)).sort() : [];
      return send(res, 200, files.map((f) => ({ name: f.replace(/\.txt$/, ''), text: readFileSync(join(samplesDir, f), 'utf8') })));
    }

    if (req.method === 'POST' && url.pathname === '/api/match') {
      // Streams one JSON row per line as soon as it is matched, so the table fills while the model works.
      if (activeMatch) return send(res, 409, { error: 'Already matching an order. Wait for it to finish.' });
      const { text, lines: only, force } = await readJson<{ text?: string; lines?: string[]; force?: boolean }>(req);
      if ((text === undefined) === (only === undefined) || (text !== undefined && typeof text !== 'string') || (only !== undefined && (!Array.isArray(only) || !only.every((line) => typeof line === 'string'))) || (force !== undefined && typeof force !== 'boolean')) {
        throw new HttpError(400, 'provide either text (string) or lines (string array), and optional force (boolean)');
      }
      const lines = only ?? splitOrder(text ?? '');
      // Reading a body yields: another request may have acquired the slot meanwhile.
      if (activeMatch) return send(res, 409, { error: 'Already matching an order. Wait for it to finish.' });
      const controller = new AbortController();
      activeMatch = controller;
      const matchCtx = { ...ctx, llm: { ...ctx.llm, signal: controller.signal } };
      const matchLearned = learned;
      res.once('close', () => {
        if (!res.writableEnded) {
          controller.abort();
          if (activeMatch === controller) activeMatch = null;
        }
      });
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      try {
        const useModel = await modelReady(controller.signal);
        if (controller.signal.aborted) return;
        res.write(JSON.stringify({ type: 'start', total: lines.length, useModel }) + '\n');
        for (let i = 0; i < lines.length; i++) {
          if (controller.signal.aborted) return;
          const row = await matchLine(i + 1, lines[i], matchCtx, matchLearned, useModel, !!force);
          if (controller.signal.aborted) return;
          res.write(JSON.stringify({ type: 'row', row }) + '\n');
        }
        res.end(JSON.stringify({ type: 'done' }) + '\n');
      } finally {
        if (activeMatch === controller) activeMatch = null;
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/confirm') {
      const { rows, remember } = await readJson<{ rows: ConfirmedRow[]; remember: { alias: string; sku: string }[] }>(req);
      if (!Array.isArray(rows) || !rows.every((row) => isObject(row) && Number.isInteger(row.line) && row.line > 0 && typeof row.text === 'string' && (row.status === 'confirmed' || row.status === 'skipped') && (row.sku === null || typeof row.sku === 'string') && (row.qty === null || typeof row.qty === 'number') && (row.unit === null || typeof row.unit === 'string') && (row.note === undefined || typeof row.note === 'string'))) {
        throw new HttpError(400, 'rows must be an array of review rows');
      }
      if (remember !== undefined && (!Array.isArray(remember) || !remember.every((entry) => isObject(entry) && typeof entry.alias === 'string' && typeof entry.sku === 'string'))) {
        throw new HttpError(400, 'remember must be an array of alias and sku strings');
      }
      const errors = checkConfirmed(rows, ctx.index);
      if (errors.length) return send(res, 400, { ok: false, errors });
      let learnedNow = 0;
      // Only teach names the catalogue doesn't already know; a known name with a missing size is not a new name.
      for (const r of remember ?? []) {
        const confirmed = rows.some((row) => row.status === 'confirmed' && row.note !== 'automatic' && row.sku === r.sku && parse(row.text, { namePhrases: numberNamePhrases(catalog) }).productText === normalize(r.alias));
        if (confirmed && ctx.index.has(r.sku) && !nameIsKnown(r.alias, catalog) && addLearned(learnedPath, learned, r.alias, r.sku)) learnedNow++;
      }
      const csv = exportCsv(rows, ctx.index);
      const file = join(dataDir, 'exports', `order-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.csv`);
      ensureDir(file);
      writeFileSync(file, csv);
      return send(res, 200, { ok: true, csv, file: file.replace(`${root}/`, ''), learned: learnedNow, learnedTotal: learned.size });
    }

    send(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) send(res, e instanceof HttpError ? e.status : 500, { error: (e as Error).message });
    else res.end();
  }
});

server.listen(port, '127.0.0.1', async () => {
  const address = server.address();
  console.log(`ParchiMatch Lite → http://127.0.0.1:${address && typeof address !== 'string' ? address.port : port}`);
  console.log(`catalogue ${catalog.length} items (${catalogPath.replace(`${root}/`, '')} · ${startup.why}) · learned names ${learned.size} · model ${model} ${(await modelReady()) ? 'ready' : 'NOT available, fuzzy only'}`);
});

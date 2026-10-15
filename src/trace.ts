import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

// Opt-in tracing for the evaluation harness only (npm run eval with SENTRY_DSN set). The shop app never imports
// this file. @sentry/node is not a dependency: it is loaded with import() only when tracing is switched on.

export type SpanValue = string | number | boolean;

export interface Span {
  setAttribute(key: string, value: SpanValue): void;
  setAttributes(attributes: Record<string, SpanValue>): void;
  setStatus(status: { code: number; message?: string }): void;
}

export interface SpanOptions {
  name: string;
  op?: string;
  attributes?: Record<string, SpanValue | undefined>;
  newTrace?: boolean; // start a fresh trace (an eval run), instead of joining whatever ran before it
}

export interface Tracer {
  startSpan<T>(options: SpanOptions, fn: (span: Span) => T): T;
  flush(): Promise<void>;
}

const silent: Span = { setAttribute() {}, setAttributes() {}, setStatus() {} };

export const noopTracer: Tracer = {
  startSpan: (_options, fn) => fn(silent),
  flush: async () => {},
};

export const NOT_INSTALLED = 'Tracing needs @sentry/node: npm install --no-save @sentry/node';

export class TracingUnavailable extends Error {}

interface SentryModule {
  init(options: Record<string, unknown>): unknown;
  startSpan<T>(options: { name: string; op?: string; attributes?: Record<string, SpanValue> }, fn: (span: Span) => T): T;
  startNewTrace?<T>(fn: () => T): T;
  flush(timeoutMs: number): Promise<boolean>;
}

export interface TracerOptions {
  release?: string;
  importer?: (name: string) => Promise<unknown>; // tests pass a fake; the default is a real dynamic import
}

export async function makeTracer(env: Record<string, string | undefined>, options: TracerOptions = {}): Promise<Tracer> {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return noopTracer;
  let sentry: SentryModule;
  try {
    sentry = (await (options.importer ?? ((name: string) => import(name)))('@sentry/node')) as SentryModule;
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_MODULE_NOT_FOUND') throw new TracingUnavailable(NOT_INSTALLED);
    throw e;
  }
  sentry.init({ dsn, tracesSampleRate: 1.0, environment: 'eval', ...(options.release ? { release: options.release } : {}) });
  return {
    startSpan: (o, fn) => {
      const attributes = Object.fromEntries(Object.entries(o.attributes ?? {}).filter(([, v]) => v !== undefined)) as Record<string, SpanValue>;
      const start = () => sentry.startSpan({ name: o.name, op: o.op, attributes }, fn);
      // Without a fresh trace, the pre-run model check (an http.client span) became the root of every eval trace.
      return o.newTrace && sentry.startNewTrace ? sentry.startNewTrace(start) : start();
    },
    flush: async () => {
      await sentry.flush(5000);
    },
  };
}

// Resolves symlinks in the deepest existing part of the path, so "../" or a link can't slip past the guard.
function realish(path: string): string {
  let existing = path;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  return join(realpathSync(existing), relative(existing, path));
}

// Only synthetic or fixture data may be traced; real or human-written orders never go to Sentry.
export function allowedForTracing(path: string, root: string): boolean {
  const file = realish(resolve(path));
  return ['data/synthetic', 'data/fixture'].some((dir) => {
    const rel = relative(realish(join(root, dir)), file);
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  });
}

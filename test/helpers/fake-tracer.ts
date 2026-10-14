// Purpose: an in-memory tracer with the same startSpan(options, fn) + flush() shape as src/trace.ts.
// It records the span tree (nesting follows async context, as Sentry's does) and sends nothing anywhere.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Span, SpanOptions, Tracer } from '../../src/trace.ts';

export interface FakeSpan {
  name: string;
  op?: string;
  attributes: Record<string, unknown>;
  status: { code: number; message?: string } | null;
  children: FakeSpan[];
}

export function fakeTracer() {
  const roots: FakeSpan[] = [];
  const all: FakeSpan[] = [];
  const current = new AsyncLocalStorage<FakeSpan>();
  let flushed = 0;
  const tracer: Tracer = {
    startSpan<T>(options: SpanOptions, fn: (span: Span) => T): T {
      const span: FakeSpan = { name: options.name, op: options.op, attributes: { ...options.attributes }, status: null, children: [] };
      (current.getStore()?.children ?? roots).push(span);
      all.push(span);
      const handle: Span = {
        setAttribute: (key, value) => { span.attributes[key] = value; },
        setAttributes: (attrs) => { Object.assign(span.attributes, attrs); },
        setStatus: (status) => { span.status = status; },
      };
      return current.run(span, () => fn(handle));
    },
    async flush() { flushed++; },
  };
  return { tracer, roots, all, flushes: () => flushed };
}

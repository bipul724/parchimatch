// Purpose: deterministic, scriptable local Ollama responses with complete request recording.
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface StubRequest { method: string; path: string; body: any }
export interface ChatStep {
  content?: string | object;
  status?: number;
  error?: string;
  body?: unknown;
  delayMs?: number;
}
export interface StubOptions {
  model?: string;
  models?: string[];
  tagsStatus?: number;
  steps?: ChatStep[];
  handler?: (request: StubRequest, chatIndex: number) => ChatStep | Promise<ChatStep>;
}

export async function startOllamaStub(options: StubOptions = {}) {
  const model = options.model ?? 'test-model';
  let models = options.models ?? [model];
  let tagsStatus = options.tagsStatus ?? 200;
  let handler = options.handler;
  const steps = [...(options.steps ?? [])];
  const requests: StubRequest[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let chatIndex = 0;
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    let body: any = null;
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
    const request = { method: req.method ?? '', path: req.url ?? '', body };
    requests.push(request);
    const reply = (status: number, payload: unknown) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (request.method === 'GET' && request.path === '/api/tags') return reply(tagsStatus, { models: models.map((name) => ({ name })) });
    if (request.method === 'GET' && request.path === '/api/ps') return reply(200, { models: models.map((name) => ({ name, size: 1, size_vram: 1 })) });
    if (request.method !== 'POST' || request.path !== '/api/chat') return reply(404, { error: 'not found' });
    const step = steps.shift() ?? (handler ? await handler(request, chatIndex++) : { content: { evidence: '', sku: '', status: 'needs_review' } });
    const finish = () => reply(step.status ?? 200, step.body ?? (step.error ? { error: step.error } : { message: { content: typeof step.content === 'string' ? step.content : JSON.stringify(step.content ?? {}) } }));
    if (step.delayMs) {
      const timer = setTimeout(() => { timers.delete(timer); finish(); }, step.delayMs);
      timers.add(timer);
    } else finish();
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('stub did not bind TCP');
  return {
    url: `http://127.0.0.1:${address.port}`, model, requests,
    enqueue: (...next: ChatStep[]) => { steps.push(...next); },
    reset: () => { requests.length = 0; steps.length = 0; chatIndex = 0; handler = undefined; },
    setHandler: (next: StubOptions['handler']) => { handler = next; },
    setModels: (next: string[]) => { models = next; },
    setTagsStatus: (next: number) => { tagsStatus = next; },
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

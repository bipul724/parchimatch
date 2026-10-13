import { parseModelOutput, RESPONSE_SCHEMA } from './prompt.ts';
import type { ChatMessage } from './prompt.ts';
import type { LlmTrace, ModelChoice } from './types.ts';

export interface LlmConfig {
  url: string; // Ollama, bound to 127.0.0.1
  model: string;
  think: boolean;
  numCtx: number;
  signal?: AbortSignal;
}

export async function availableModels(url: string, signal?: AbortSignal): Promise<string[] | null> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal });
    if (!res.ok) return null;
    const j = (await res.json()) as { models?: { name: string }[] };
    return (j.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

export async function loadedModels(url: string): Promise<{ name: string; size: number; size_vram: number }[]> {
  try {
    const res = await fetch(`${url}/api/ps`);
    const j = (await res.json()) as { models?: { name: string; size: number; size_vram: number }[] };
    return j.models ?? [];
  } catch {
    return [];
  }
}

let thinkUnsupported = false;

async function chatOnce(cfg: LlmConfig, messages: ChatMessage[]): Promise<string> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    stream: false,
    format: RESPONSE_SCHEMA,
    options: { temperature: 0, seed: 7, num_ctx: cfg.numCtx },
    keep_alive: '15m',
  };
  // Qwen3.5 is a thinking model; thinking off keeps latency down. Some Ollama versions skip the
  // schema when a thinking model answers without thinking, which is why every reply is validated.
  if (!thinkUnsupported) body.think = cfg.think;
  const res = await fetch(`${cfg.url}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: cfg.signal,
  });
  if (!res.ok) {
    const text = await res.text();
    if (!thinkUnsupported && /think/i.test(text)) {
      thinkUnsupported = true;
      return chatOnce(cfg, messages);
    }
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 300)}`);
  }
  const j = (await res.json()) as { message?: { content?: string } };
  return j.message?.content ?? '';
}

// One repair attempt on invalid JSON, then give up and let the row go to review.
export async function decide(cfg: LlmConfig, messages: ChatMessage[]): Promise<{ proposal: ModelChoice | null; trace: LlmTrace }> {
  const start = performance.now();
  let raw = '';
  try {
    raw = await chatOnce(cfg, messages);
    let proposal = parseModelOutput(raw);
    if (proposal) return { proposal, trace: { ms: performance.now() - start, validFirstTry: true, retries: 0, raw } };
    const repair: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: raw },
      { role: 'user', content: 'That reply did not match the required JSON fields. Reply again with JSON only.' },
    ];
    raw = await chatOnce(cfg, repair);
    proposal = parseModelOutput(raw);
    return { proposal, trace: { ms: performance.now() - start, validFirstTry: false, retries: 1, raw } };
  } catch (e) {
    return { proposal: null, trace: { ms: performance.now() - start, validFirstTry: false, retries: 0, raw, error: (e as Error).message } };
  }
}

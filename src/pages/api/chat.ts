/**
 * POST /api/chat — the site assistant.
 *
 * Request:  { messages: { role: 'user' | 'assistant', content: string }[], page?: string }
 * Response: newline-delimited JSON events, streamed as they happen:
 *   { t: 'search', q }                      the assistant is searching the site
 *   { t: 'text', d }                        a piece of the answer (Markdown)
 *   { t: 'cite', n: number[] }              sources backing the text just sent
 *   { t: 'sources', items: Source[] }       the numbered sources (sent before the first 'cite')
 *   { t: 'done' } | { t: 'error', m }
 *
 * Retrieval: the model is given a `search_site` tool backed by the BM25 index in
 * src/lib/rag.ts. It writes its own Arabic queries (so English questions work
 * too) and may search several times; answers cite the pages they came from.
 *
 * Provider (see src/lib/assistant/):
 *   GEMINI_API_KEY     Google Gemini, free tier available (default when set). GEMINI_MODEL: comma-separated models tried in order when one is busy (default gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite).
 *   ANTHROPIC_API_KEY  Claude. CHAT_MODEL (default claude-opus-5-5), CHAT_EFFORT (low | medium | high, default low).
 *   CHAT_PROVIDER      gemini | anthropic, to choose when both keys are set.
 */
import type { APIRoute } from 'astro';
import type { ChatMessage, Event } from '../../lib/assistant/shared';

export const prerender = false;

const env = (k: string) => (import.meta.env[k] as string | undefined) ?? process.env[k];
const MAX_HISTORY = 16;
const MAX_CHARS = 2000;

type Provider = { run: (input: Parameters<typeof import('../../lib/assistant/gemini').runGemini>[2]) => Promise<void>; error: (e: unknown) => string };

/** Picks the provider from the env: CHAT_PROVIDER if set, else whichever key exists (Gemini first). */
async function provider(): Promise<Provider | null> {
  const gemini = env('GEMINI_API_KEY') || env('GOOGLE_API_KEY');
  const claude = env('ANTHROPIC_API_KEY');
  const choice = (env('CHAT_PROVIDER') || (gemini ? 'gemini' : claude ? 'anthropic' : '')).toLowerCase();
  if (choice === 'gemini' && gemini) {
    const { runGemini, geminiError, DEFAULT_GEMINI_MODEL } = await import('../../lib/assistant/gemini');
    const model = env('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
    return { run: (i) => runGemini(gemini, model, i), error: geminiError };
  }
  if ((choice === 'anthropic' || choice === 'claude') && claude) {
    const { runClaude, claudeError, DEFAULT_CLAUDE_MODEL } = await import('../../lib/assistant/anthropic');
    const model = env('CHAT_MODEL') || DEFAULT_CLAUDE_MODEL;
    const effort = (env('CHAT_EFFORT') || 'low') as 'low' | 'medium' | 'high';
    return { run: (i) => runClaude(claude, model, effort, i), error: claudeError };
  }
  return null;
}

// Best-effort per-instance rate limit: 20 requests per IP per 10 minutes.
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 20;
}

function clean(body: unknown): { messages: ChatMessage[]; page?: string } | null {
  if (!body || typeof body !== 'object') return null;
  const { messages, page } = body as { messages?: unknown; page?: unknown };
  if (!Array.isArray(messages) || !messages.length) return null;
  const out: ChatMessage[] = [];
  for (const m of messages.slice(-MAX_HISTORY)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    const content = m.content.trim().slice(0, m.role === 'user' ? MAX_CHARS : 6000);
    if (content) out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length || out[out.length - 1].role !== 'user') return null;
  return { messages: out, page: typeof page === 'string' ? page.slice(0, 300) : undefined };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const chosen = await provider();
  if (!chosen) return Response.json({ error: 'not_configured' }, { status: 503 });

  let ip = 'unknown';
  try { ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || clientAddress; } catch {}
  if (limited(ip)) return Response.json({ error: 'rate_limited' }, { status: 429 });

  const input = clean(await request.json().catch(() => null));
  if (!input) return Response.json({ error: 'bad_request' }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let failed = false;
      const send = (e: Event) => {
        if (e.t === 'error') failed = true;
        controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
      };
      try {
        await chosen.run({ ...input, send, signal: request.signal });
        if (!failed) send({ t: 'done' });
      } catch (err) {
        if (request.signal.aborted) return;
        console.error('chat error', err);
        try { send({ t: 'error', m: chosen.error(err) }); } catch {}
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
};

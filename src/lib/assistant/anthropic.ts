/**
 * Claude provider. Search results go back as `search_result` blocks with
 * citations on, so every claim points at the page it came from.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Hit } from '../rag';
import { MAX_SEARCHES, Citations, TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMS, NO_HITS, runSearch, systemPrompt, pageNote, type RunInput } from './shared';

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    input_schema: { ...TOOL_PARAMS, required: [...TOOL_PARAMS.required], additionalProperties: false },
    cache_control: { type: 'ephemeral' },
  },
];

let system: string | undefined;

export async function runClaude(apiKey: string, model: string, effort: 'low' | 'medium' | 'high', { messages: input, page, send, signal }: RunInput) {
  // Server-side refusal fallback exists for these models only.
  const fallback = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const citations = new Citations(send);
  system ??= systemPrompt('native');

  const messages: Anthropic.Beta.BetaMessageParam[] = input.map((m, i) => {
    const last = i === input.length - 1;
    if (!last || !page) return { role: m.role, content: m.content };
    return { role: 'user', content: [{ type: 'text', text: pageNote(page) }, { type: 'text', text: m.content }] };
  });

  // Every search_result block sent so far, in request order: citations refer to them by index.
  const results: Hit[] = [];
  let searches = 0;
  for (let turn = 0; turn < MAX_SEARCHES + 2; turn++) {
    const allowTools = searches < MAX_SEARCHES;
    const s = client.beta.messages.stream(
      {
        model,
        max_tokens: 8000,
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        output_config: { effort },
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        tool_choice: allowTools ? { type: 'auto' } : { type: 'none' },
        messages,
      },
      { signal },
    );

    let cites = new Set<number>();
    for await (const ev of s) {
      if (ev.type === 'content_block_start' && ev.content_block.type === 'text') cites = new Set();
      if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') send({ t: 'text', d: ev.delta.text });
        else if (ev.delta.type === 'citations_delta' && ev.delta.citation.type === 'search_result_location') {
          const hit = results[ev.delta.citation.search_result_index];
          if (hit) cites.add(citations.number(hit));
        }
      }
      if (ev.type === 'content_block_stop' && cites.size) {
        send({ t: 'cite', n: [...cites].sort((a, b) => a - b) });
        cites = new Set();
      }
    }
    const msg = await s.finalMessage();
    if (msg.stop_reason === 'refusal') {
      send({ t: 'error', m: 'refusal' });
      return;
    }
    if (msg.stop_reason !== 'tool_use') return;

    // Run the searches the model asked for and hand the passages back.
    messages.push({ role: 'assistant', content: msg.content });
    const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue;
      const found = block.name === TOOL_NAME ? runSearch(block.input) : null;
      if (!found) {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: 'Invalid call: provide a non-empty Arabic "query".' });
        continue;
      }
      searches++;
      send({ t: 'search', q: found.query });
      results.push(...found.hits);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: found.hits.length
          ? found.hits.map((h) => ({
              type: 'search_result' as const,
              source: h.path,
              title: `${h.trail} (${h.unit})`,
              content: h.paragraphs.map((text) => ({ type: 'text' as const, text })),
              citations: { enabled: true },
            }))
          : [{ type: 'text' as const, text: NO_HITS }],
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }
}

/** Maps a Claude API error to the error code the browser shows. */
export function claudeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return 'busy';
  if (err instanceof Anthropic.AuthenticationError) return 'not_configured';
  if (err instanceof Anthropic.APIError && (err.status ?? 0) >= 500) return 'busy';
  return 'failed';
}

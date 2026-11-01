/**
 * Google Gemini provider (has a free tier: key from https://aistudio.google.com/apikey).
 *
 * Same agentic loop as the Claude provider: the model calls `search_site`, we
 * run the BM25 search and send the passages back. Gemini has no native
 * citations, so each passage is numbered "[k]" and the model is told to write
 * those numbers after its claims; BracketCitations turns them into `cite` events.
 */
import { GoogleGenAI, ApiError, FunctionCallingConfigMode, type Content, type Part } from '@google/genai';
import type { Hit } from '../rag';
import {
  MAX_SEARCHES, Citations, BracketCitations, TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMS,
  NO_HITS, runSearch, systemPrompt, pageNote, type RunInput,
} from './shared';

/**
 * Models to try, in order. Free-tier models are sometimes overloaded (503) or
 * rate limited (429); the next one in the list is used then, for the rest of
 * the answer. GEMINI_MODEL can override this with a comma-separated list.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite';
/** A model that has not started answering within this time is treated as overloaded. */
const FIRST_CHUNK_MS = 12_000;

class Overloaded extends Error {}

export async function runGemini(apiKey: string, modelList: string, { messages, page, send, signal }: RunInput) {
  const ai = new GoogleGenAI({ apiKey });
  const citations = new Citations(send);
  // Passage numbers the model sees, per request: k -> hit.
  const shown: Hit[] = [];
  const brackets = new BracketCitations((k) => (shown[k - 1] ? citations.number(shown[k - 1]) : null), send);

  const contents: Content[] = messages.map((m, i) => {
    const last = i === messages.length - 1;
    const text = last && page ? `${pageNote(page)}\n\n${m.content}` : m.content;
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] };
  });
  const system = systemPrompt('brackets');
  const tools = [{ functionDeclarations: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, parametersJsonSchema: TOOL_PARAMS }] }];

  const models = modelList.split(',').map((m) => m.trim()).filter(Boolean);
  let current = 0;

  /** One model round. Throws Overloaded if the model is busy before it has sent anything. */
  async function round(model: string, allowTools: boolean, modelParts: Part[], calls: { id?: string; name?: string; args?: unknown }[]) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal.addEventListener('abort', onAbort);
    let started = false;
    const timer = setTimeout(() => ctrl.abort(), FIRST_CHUNK_MS);
    try {
      const stream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction: system,
          abortSignal: ctrl.signal,
          maxOutputTokens: 4000,
          tools,
          // After the search budget is spent, the model must answer with what it has.
          toolConfig: { functionCallingConfig: { mode: allowTools ? FunctionCallingConfigMode.AUTO : FunctionCallingConfigMode.NONE } },
        },
      });
      for await (const chunk of stream) {
        if (!started) { started = true; clearTimeout(timer); }
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          modelParts.push(part);
          if (part.functionCall) calls.push(part.functionCall);
          else if (part.text && !part.thought) brackets.push(part.text);
        }
      }
    } catch (err) {
      if (signal.aborted) throw err;
      const busy = (err instanceof ApiError && (err.status === 429 || err.status >= 500)) || ctrl.signal.aborted;
      if (busy && !started) throw new Overloaded(model);
      throw err;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }

  let searches = 0;
  for (let turn = 0; turn < MAX_SEARCHES + 2; turn++) {
    const allowTools = searches < MAX_SEARCHES;
    // Keep every part the model sent (thought signatures included) to send back with the tool results.
    let modelParts: Part[] = [];
    let calls: { id?: string; name?: string; args?: unknown }[] = [];
    for (;;) {
      try {
        await round(models[current], allowTools, modelParts, calls);
        break;
      } catch (err) {
        if (!(err instanceof Overloaded) || current >= models.length - 1) throw err;
        console.warn(`gemini: ${models[current]} busy, trying ${models[current + 1]}`);
        current++;
        modelParts = [];
        calls = [];
      }
    }
    brackets.flush();
    if (!calls.length) return;

    contents.push({ role: 'model', parts: modelParts });
    const responses: Part[] = [];
    for (const call of calls) {
      const found = call.name === TOOL_NAME ? runSearch(call.args) : null;
      let result: string;
      if (!found) {
        result = 'Invalid call: provide a non-empty Arabic "query".';
      } else {
        searches++;
        send({ t: 'search', q: found.query });
        result = found.hits.length
          ? found.hits
              .map((h) => {
                shown.push(h);
                return `[${shown.length}] ${h.trail} (${h.unit}) — ${h.path}\n${h.paragraphs.join('\n')}`;
              })
              .join('\n\n')
          : NO_HITS;
      }
      responses.push({ functionResponse: { id: call.id, name: call.name ?? TOOL_NAME, response: { result } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
}

/** Maps a Gemini API error to the error code the browser shows. */
export function geminiError(err: unknown): string {
  if (err instanceof Overloaded) return 'busy';
  if (err instanceof ApiError) {
    if (err.status === 429 || err.status >= 500) return 'busy';
    if (err.status === 401 || err.status === 403 || /API key/i.test(err.message)) return 'not_configured';
  }
  return 'failed';
}

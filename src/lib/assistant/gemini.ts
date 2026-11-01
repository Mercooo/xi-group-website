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

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export async function runGemini(apiKey: string, model: string, { messages, page, send, signal }: RunInput) {
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

  let searches = 0;
  for (let turn = 0; turn < MAX_SEARCHES + 2; turn++) {
    const allowTools = searches < MAX_SEARCHES;
    const stream = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: system,
        abortSignal: signal,
        maxOutputTokens: 4000,
        tools,
        // After the search budget is spent, the model must answer with what it has.
        toolConfig: { functionCallingConfig: { mode: allowTools ? FunctionCallingConfigMode.AUTO : FunctionCallingConfigMode.NONE } },
      },
    });

    // Keep every part the model sent (thought signatures included) to send back with the tool results.
    const modelParts: Part[] = [];
    const calls: { id?: string; name?: string; args?: unknown }[] = [];
    for await (const chunk of stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        modelParts.push(part);
        if (part.functionCall) calls.push(part.functionCall);
        else if (part.text && !part.thought) brackets.push(part.text);
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
  if (err instanceof ApiError) {
    if (err.status === 429 || err.status >= 500) return 'busy';
    if (err.status === 401 || err.status === 403 || /API key/i.test(err.message)) return 'not_configured';
  }
  return 'failed';
}

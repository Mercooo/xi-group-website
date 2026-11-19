// Reads payment screenshots for the fest-buy Supabase function.
//   - With GEMINI_API_KEY set in this Vercel project, and a valid one-time pass from fest-buy,
//     Gemini (vision) transcribes the screenshot into fields (free tier).
//   - Otherwise Tesseract OCR (English + Arabic, free, no AI, no key) returns plain text.
// It only reads; deciding whether a payment is valid happens in fest-buy.
import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { createWorker, type Worker } from 'tesseract.js';
import { API } from '../../lib/site';
import { GEMINI_MODELS, GEMINI_SCHEMA, SYSTEM } from '../../lib/receipt-ai';

export const prerender = false;

const MAX_BYTES = 4_400_000; // Vercel request body limit is 4.5 MB
let worker: Promise<Worker> | null = null;

// One worker per warm function instance; language data is cached in /tmp.
const getWorker = () => (worker ??= createWorker(['eng', 'ara'], 1, { cachePath: '/tmp/tesseract' }).catch((e) => {
  worker = null;
  throw e;
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

function sniff(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}

/** fest-buy issues a one-time pass per screenshot; redeeming it proves the request came from a real booking. */
async function passOk(token: string, bytes: Uint8Array) {
  if (!/^[a-f0-9]{32,64}$/.test(token)) return false;
  const sha = createHash('sha256').update(bytes).digest('hex');
  try {
    const r = await fetch(`${API}/fest-ticket?read_token=${token}&sha=${sha}`, { signal: AbortSignal.timeout(8000) });
    return !!(await r.json()).ok;
  } catch {
    return false;
  }
}

async function readWithGemini(key: string, bytes: Uint8Array, mime: string) {
  const ai = new GoogleGenAI({ apiKey: key });
  const models = (process.env.GEMINI_MODEL || GEMINI_MODELS).split(',').map((m) => m.trim()).filter(Boolean);
  let last = '';
  const t0 = Date.now();
  for (const model of models) {
    // A busy model can hang; give each one a slice of the time and keep room for the fallback.
    const left = 40_000 - (Date.now() - t0);
    if (left < 4_000) break;
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: Buffer.from(bytes).toString('base64') } }, { text: 'Transcribe this payment screenshot.' }] }],
        config: { systemInstruction: SYSTEM, responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA as any, temperature: 0, abortSignal: AbortSignal.timeout(Math.min(18_000, left)) },
      });
      if (res.text) return { fields: JSON.parse(res.text), model };
      last = `${model}: empty`;
    } catch (e: any) {
      last = `${model}: ${String(e?.message || e).slice(0, 160)}`;
      if ([429, 500, 503, 404].includes(e?.status) || /abort|timeout/i.test(String(e?.name) + String(e?.message))) continue; // busy, slow or unavailable: next model
      break;
    }
  }
  console.error('gemini failed', last);
  return null;
}

export const POST: APIRoute = async ({ request }) => {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return json({ error: 'too_big' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length < 16 || bytes.length > MAX_BYTES) return json({ error: 'bad_size' }, 400);
  const mime = sniff(bytes);
  if (!mime) return json({ error: 'bad_file' }, 400);
  const t0 = Date.now();

  const key = geminiKey();
  const token = request.headers.get('x-read-token') || '';
  if (key && token && (await passOk(token, bytes))) {
    const ai = await readWithGemini(key, bytes, mime);
    if (ai) return json({ ...ai, ms: Date.now() - t0 });
    // Gemini busy or failing: fall back to the free reader below.
  }

  try {
    const w = await getWorker();
    const { data } = await w.recognize(Buffer.from(bytes));
    return json({ text: data.text, confidence: data.confidence, ms: Date.now() - t0 });
  } catch (e) {
    console.error('ocr failed', e);
    return json({ error: 'ocr_failed' }, 500);
  }
};

// Health check: says which reader is active (never the key itself).
export const GET: APIRoute = () => json({ ok: true, ai: geminiKey() ? 'gemini' : null, fallback: 'tesseract', languages: ['eng', 'ara'] });

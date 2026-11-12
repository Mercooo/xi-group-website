// Free text recognition for payment screenshots (Tesseract, English + Arabic, no AI, no key).
// Called server-to-server by the fest-buy Supabase function when no AI key is configured.
// It only returns the text it reads; deciding whether a payment is valid happens in fest-buy.
import type { APIRoute } from 'astro';
import { createWorker, type Worker } from 'tesseract.js';

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

const isImage = (b: Uint8Array) =>
  (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || // jpeg
  (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || // png
  (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45); // webp

export const POST: APIRoute = async ({ request }) => {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return json({ error: 'too_big' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length < 16 || bytes.length > MAX_BYTES) return json({ error: 'bad_size' }, 400);
  if (!isImage(bytes)) return json({ error: 'bad_file' }, 400);
  const t0 = Date.now();
  try {
    const w = await getWorker();
    const { data } = await w.recognize(Buffer.from(bytes));
    return json({ text: data.text, confidence: data.confidence, ms: Date.now() - t0 });
  } catch (e) {
    console.error('ocr failed', e);
    return json({ error: 'ocr_failed' }, 500);
  }
};

export const GET: APIRoute = () => json({ ok: true, engine: 'tesseract', languages: ['eng', 'ara'] });

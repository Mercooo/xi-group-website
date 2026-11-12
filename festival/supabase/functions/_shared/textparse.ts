// Turns plain OCR text (Tesseract, no AI) into the same fields the vision models return,
// so the same rules in rules.ts can judge it. OCR can't tell layout as well as a model,
// so this only reports what it is confident about and leaves the rest null; anything
// missing sends the order to a person. Pure functions, no I/O.
import { type Ocr, type Recipient, maskedCompare, normName } from "./rules.ts";

const toWestern = (s: string) =>
  s.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/\u066b/g, ".").replace(/\u066c/g, ",");
// Bidi marks Tesseract leaves around mixed Arabic/Latin runs.
const clean = (s: string) => toWestern(s).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/[ \t]+/g, " ");

const FROM = /\b(from|sender|sent by)\b|(^|\s)(من|المرسل|المحول)(\s|$)/i;
const SUCCESS = /\b(successful(ly)?|success|completed|approved|done)\b|تمت|بنجاح|ناجح/i;
const FAILED = /\b(failed|declined|unsuccessful|rejected|reversed)\b|فشل|فشلت|مرفوض|لم تتم|غير ناجح/i;
const PENDING = /\b(pending|processing|in progress)\b|قيد التنفيذ|جاري/i;
const INSTAPAY = /insta\s*pay|انستا\s*باي|إنستا\s*باي|انستاباي|إنستاباي|\bipa\b/i;
const CURRENCY = /\b(egp|le|l\.e)\b|e£|جنيه|ج\.?\s?م/i;
const AMOUNT_LABEL = /\b(amount|you sent|sent amount|transfer amount)\b|المبلغ|قيمة/i;
const FEE_LABEL = /\b(fees?|charges?|commission)\b|رسوم|عمولة/i;
const REF_LABEL = /\b(ref(erence)?(\s*(no|number|#))?|transaction\s*(id|no|number)|trx)\b|المرجع|الرقم المرجعي|رقم العملية|رقم المعاملة/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, مايو: 5, يونيو: 6, يوليو: 7, أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) =>
  y > 2000 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;

export function findDate(text: string): string | null {
  let m = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/); // Egypt writes day/month/year
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?,?\s+(20\d{2})\b/);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = text.match(/\b([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  for (const [name, mo] of Object.entries(MONTHS)) {
    if (/^[a-z]/.test(name)) continue;
    const r = new RegExp(`(\\d{1,2})\\s*${name}\\s*(20\\d{2})`);
    const a = text.match(r);
    if (a) return iso(+a[2], mo, +a[1]);
  }
  return null;
}

const num = (s: string) => Number(s.replace(/,/g, ""));
const AMOUNT_RE = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;

/** The transferred amount: a labelled "Amount" line wins; otherwise the currency-tagged figures must agree. */
export function findAmount(lines: string[]): number | null {
  const valuesIn = (line: string) =>
    [...line.matchAll(AMOUNT_RE)]
      .filter((m) => !/\d{6,}/.test(m[1].replace(/,/g, ""))) // not a reference or phone number
      .map((m) => num(m[1] + (m[2] ? "." + m[2] : "")))
      .filter((v) => v > 0 && v < 1_000_000);
  for (let i = 0; i < lines.length; i++) {
    if (AMOUNT_LABEL.test(lines[i]) && !FEE_LABEL.test(lines[i])) {
      const v = valuesIn(lines[i]).concat(valuesIn(lines[i + 1] || ""));
      if (v.length) return v[0];
    }
  }
  const tagged = new Set<number>();
  for (const line of lines) {
    if (FEE_LABEL.test(line) || !CURRENCY.test(line)) continue;
    for (const v of valuesIn(line)) tagged.add(v);
  }
  return tagged.size === 1 ? [...tagged][0] : null;
}

export function findReference(lines: string[], recipient: Recipient): string | null {
  const phones = recipient.phones.map((p) => p.replace(/\D/g, ""));
  const pick = (line: string) =>
    (line.match(/[A-Z0-9]{6,30}/gi) || []).filter((t) => /\d{5,}/.test(t) && !phones.some((p) => t.includes(p.slice(-8)))).sort((a, b) => b.length - a.length)[0];
  for (let i = 0; i < lines.length; i++) {
    if (REF_LABEL.test(lines[i])) {
      const t = pick(lines[i]) || pick(lines[i + 1] || "");
      if (t) return t;
    }
  }
  // An unlabelled long number (10-20 digits) that isn't a phone or a date.
  const long = lines.flatMap((l) => l.match(/\b\d{10,20}\b/g) || []).filter((t) => !/^01\d{9}$/.test(t) && !/^201\d{9}$/.test(t));
  return long.length === 1 ? long[0] : null;
}

const normHandle = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/@instapay$/, "");

/** Masked digit runs such as 0100****663. Tesseract sometimes reads * as + or x and, in RTL lines, reverses the parts. */
function digitTokens(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/[0-9][0-9*+xX\u2022#\s-]{6,20}[0-9]/g)) {
    const t = m[0].replace(/[\s-]/g, "").replace(/[+xX\u2022#]/g, "*");
    if (t.replace(/\*/g, "").length < 4) continue;
    out.push(t);
    const parts = t.match(/\d+|\*+/g) || [];
    if (parts.length > 1) out.push([...parts].reverse().join(""));
  }
  return out;
}

const localPhone = (d: string) => {
  let x = d;
  if (x.startsWith("0020")) x = x.slice(4);
  else if (x.startsWith("20") && x.replace(/\*/g, "").length >= 10 && x.length === 12) x = x.slice(2);
  if (x.length === 10 && /^1/.test(x)) x = "0" + x;
  return x;
};

/**
 * Looks for the configured receiver anywhere on the screen, skipping lines that belong to
 * the sender ("From …"). Returns what was found in the shape the rules expect.
 */
export function findRecipient(lines: string[], r: Recipient): { address: string | null; name: string | null } {
  const isSender = (i: number) => FROM.test(lines[i]) || (i > 0 && FROM.test(lines[i - 1]) && lines[i - 1].length < 25);
  for (let i = 0; i < lines.length; i++) {
    if (isSender(i)) continue;
    const low = lines[i].toLowerCase().replace(/\s+/g, "");
    for (const h of r.handles) {
      const k = normHandle(h);
      if (k && low.includes(k)) return { address: h, name: null };
    }
    for (const tok of digitTokens(lines[i])) {
      const t = localPhone(tok);
      for (const p of r.phones) {
        const k = localPhone(p.replace(/\D/g, ""));
        if (maskedCompare(t, k, 4) === "match") return { address: tok, name: null };
      }
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (isSender(i)) continue;
    const words = normName(lines[i]);
    for (const n of r.names) {
      const k = normName(n);
      if (k.length && words.join(" ").includes(k.join(" "))) return { address: null, name: n };
    }
  }
  return { address: null, name: null };
}

export function parseReceiptText(raw: string, recipient: Recipient): Ocr {
  const text = clean(raw);
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const letters = text.replace(/[^\p{L}\p{N}]/gu, "").length;
  const failed = FAILED.test(text), success = SUCCESS.test(text) && !failed;
  const amount = findAmount(lines);
  const who = findRecipient(lines, recipient);
  return {
    kind: INSTAPAY.test(text) ? "instapay" : "other",
    legible: letters >= 25,
    transfer_status: failed ? "failed" : success ? "successful" : PENDING.test(text) ? "pending" : "unclear",
    amount,
    currency: CURRENCY.test(text) ? "EGP" : null,
    recipient_name: who.name,
    recipient_address: who.address,
    sender_name: null,
    reference: findReference(lines, recipient),
    date_iso: findDate(text),
    time: text.match(/\b\d{1,2}:\d{2}(\s?[AP]M)?\b/i)?.[0] ?? null,
    looks_edited: false,
    notes: "read by OCR (Tesseract)",
  };
}

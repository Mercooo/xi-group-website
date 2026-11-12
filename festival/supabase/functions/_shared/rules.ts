// Deterministic checks on what the vision model read from a payment screenshot.
// The model only transcribes; every decision about money is made here, in code.
// Pure functions, no I/O, so they can be unit-tested anywhere.

export interface Ocr {
  kind: "instapay" | "bank_transfer" | "wallet" | "other" | "not_a_receipt";
  legible: boolean;
  transfer_status: "successful" | "failed" | "pending" | "unclear";
  amount: number | null;
  currency: string | null;
  recipient_name: string | null;
  recipient_address: string | null;
  sender_name: string | null;
  reference: string | null;
  date_iso: string | null;
  time: string | null;
  looks_edited: boolean;
  notes: string | null;
}

export interface Recipient {
  handles: string[];
  names: string[];
  phones: string[];
}

export type Status = "verified" | "review" | "rejected";
export type Match = "match" | "mismatch" | "uncertain" | "absent";

const MASK = /[*•●∗✱xX#]/g;
const westernDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)));

/**
 * Compares a possibly masked value ("0100****663", "mar***@instapay") with a known one.
 * Every visible character must line up; `minVisible` visible characters are needed for a
 * confident match, fewer gives "uncertain".
 */
export function maskedCompare(shown: string, known: string, minVisible: number): Match {
  if (!shown || !known) return "absent";
  if (!shown.includes("*")) return shown === known ? "match" : "mismatch";
  const parts = shown.split(/\*+/);
  const head = parts[0], tail = parts[parts.length - 1];
  if (!known.startsWith(head) || !known.endsWith(tail) || head.length + tail.length > known.length) return "mismatch";
  let at = head.length;
  for (const mid of parts.slice(1, -1)) {
    const i = known.indexOf(mid, at);
    if (i < 0 || i + mid.length > known.length - tail.length) return "mismatch";
    at = i + mid.length;
  }
  const visible = parts.join("").length;
  return visible >= minVisible ? "match" : "uncertain";
}

const normHandle = (s: string) =>
  s.toLowerCase().replace(/\s+/g, "").replace(/[•●∗✱]/g, "*").replace(/@instapay$/, "").replace(/^@/, "");

function normDigits(s: string) {
  let d = westernDigits(s).replace(MASK, "*").replace(/[^\d*]/g, "");
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("+20")) d = d.slice(3);
  else if (d.startsWith("20") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && /^1/.test(d)) d = "0" + d;
  return d;
}

/** InstaPay shows the receiver as an IPA handle (name@instapay), a masked mobile or a masked account. */
export function addressMatch(shown: string | null, r: Recipient): Match {
  if (!shown || !shown.trim()) return "absent";
  const s = westernDigits(shown.trim());
  const looksLikeHandle = s.includes("@") || /[a-z]/i.test(s.replace(/x/gi, ""));
  const results: Match[] = [];
  if (looksLikeHandle) {
    const h = normHandle(s);
    for (const k of r.handles) results.push(maskedCompare(h, normHandle(k), 3));
  } else {
    const d = normDigits(s);
    if (d.replace(/\*/g, "").length < 3) return "uncertain";
    for (const k of r.phones) results.push(maskedCompare(d, normDigits(k), 4));
  }
  if (!results.length) return "uncertain"; // nothing of that kind configured to compare with
  if (results.includes("match")) return "match";
  if (results.includes("uncertain")) return "uncertain";
  return "mismatch";
}

export function normName(s: string) {
  return westernDigits(s)
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "") // harakat + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[•●∗✱]/g, "*")
    .replace(/[^\p{L}\p{N}*\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function tokenMatch(shown: string, known: string): Match {
  if (!shown.includes("*")) return shown === known ? "match" : "mismatch";
  return maskedCompare(shown, known, 2);
}

/** Names are compared token by token over the first two names (InstaPay often masks the rest). */
export function nameMatch(shown: string | null, r: Recipient): Match {
  if (!shown || !shown.trim()) return "absent";
  const o = normName(shown);
  if (!o.length || !r.names.length) return o.length ? "uncertain" : "absent";
  let best: Match = "mismatch";
  for (const known of r.names) {
    const k = normName(known);
    const n = Math.min(2, o.length, k.length);
    if (!n) continue;
    const ms = Array.from({ length: n }, (_, i) => tokenMatch(o[i], k[i]));
    const m: Match = ms.includes("mismatch") ? "mismatch" : ms.every((x) => x === "match") ? (n >= 2 || o.length === 1 ? "match" : "uncertain") : "uncertain";
    if (m === "match") return "match";
    if (m === "uncertain") best = "uncertain";
  }
  return best;
}

export function recipientVerdict(o: Ocr, r: Recipient): { ok: boolean; reason?: string; hard?: boolean } {
  if (!r.handles.length && !r.names.length && !r.phones.length) return { ok: false, reason: "recipient_not_configured" };
  const a = addressMatch(o.recipient_address, r);
  const n = nameMatch(o.recipient_name, r);
  if (a === "match") return { ok: true };
  if (a === "mismatch") {
    if (n === "match") return { ok: false, reason: "recipient_address_differs" };
    return { ok: false, reason: "wrong_recipient", hard: o.legible };
  }
  // No usable address on the screenshot: rely on the name.
  if (n === "match") return { ok: true };
  if (n === "mismatch" && a === "absent") return { ok: false, reason: "wrong_recipient", hard: o.legible };
  return { ok: false, reason: "recipient_unverified" };
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's date in Cairo as YYYY-MM-DD. */
export function cairoToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function normReference(s: string | null) {
  if (!s) return null;
  const r = westernDigits(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return r.length >= 6 ? r : null;
}

/**
 * The verdict for one screenshot. Hard failures (clearly wrong amount, wrong receiver,
 * failed transfer, not a receipt) reject; anything uncertain goes to a person.
 */
export function judge(
  o: Ocr,
  opts: { price: number; recipient: Recipient; salesStart?: string | null; now?: Date; strict?: boolean },
): { status: Status; reasons: string[] } {
  const hard: string[] = [];
  const soft: string[] = [];

  if (o.kind === "not_a_receipt") hard.push("not_a_receipt");
  else if (o.kind === "other") soft.push("unknown_receipt_type");
  if (!o.legible) soft.push("unclear_image");
  if (o.looks_edited) soft.push("possible_edit");

  if (o.transfer_status === "failed") hard.push("transfer_failed");
  else if (o.transfer_status === "pending") soft.push("transfer_pending");
  else if (o.transfer_status === "unclear") soft.push("status_unclear");

  if (o.amount == null || !Number.isFinite(o.amount)) soft.push("amount_unreadable");
  else if (Math.abs(o.amount - opts.price) > 0.001) (o.legible ? hard : soft).push("wrong_amount");
  if (o.currency && !/^(egp|le|l\.e|e£|£|جنيه|ج\.?م|جم)/i.test(o.currency.trim())) soft.push("currency_unclear");

  const rv = recipientVerdict(o, opts.recipient);
  if (!rv.ok) (rv.hard ? hard : soft).push(rv.reason!);

  if (!normReference(o.reference)) soft.push("reference_missing");

  const m = o.date_iso ? ISO.exec(o.date_iso) : null;
  if (!m) soft.push("date_unreadable");
  else {
    const today = cairoToday(opts.now);
    if (o.date_iso! > addDays(today, 1)) soft.push("date_in_future");
    if (opts.salesStart && o.date_iso! < opts.salesStart) (o.legible ? hard : soft).push("transfer_before_sales");
  }

  // Plain OCR (strict: false) can misread, so it never rejects on its own: a person decides.
  if (hard.length) return { status: opts.strict === false ? "review" : "rejected", reasons: [...hard, ...soft] };
  if (soft.length) return { status: "review", reasons: soft };
  return { status: "verified", reasons: [] };
}

// Shared helpers for the fest-* functions (XI Group 74th anniversary festival).
// Every function runs with the service role; the tables have RLS on and no policies,
// so nothing is reachable from the browser except through these functions.
import { createClient } from "jsr:@supabase/supabase-js@2";

export const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

export const BUCKET = "fest-receipts";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-fest-key",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const enc = new TextEncoder();

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A daily-salted hash of the caller's IP: enough to rate-limit, not enough to identify. */
export async function ipHash(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  return (await sha256Hex(`${ip}|${day}|${Deno.env.get("SUPABASE_URL")}`)).slice(0, 32);
}

/** Constant-time string comparison. */
function same(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export type Role = "admin" | "gate";

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
export const PASS_ITERATIONS = 60_000;

/** PBKDF2-SHA256, 32 bytes, as hex. */
export async function hashPasscode(pass: string, saltHex: string, iterations = PASS_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(saltHex), iterations }, key, 256);
  return hex(bits);
}
export const newSalt = () => hex(crypto.getRandomValues(new Uint8Array(16)));

// Passcodes that already matched in this isolate (by SHA-256 of the passcode), so each
// request doesn't redo the slow hash. Cleared after five minutes or a passcode change.
const verified = new Map<string, { role: Role; at: number }>();
export const forgetPasscodes = () => verified.clear();

/** Which role a passcode opens, checking the Edge Function secrets first, then the hashed passcodes table. */
async function roleFor(key: string): Promise<Role | null> {
  const admin = Deno.env.get("FEST_ADMIN_PASSCODE") || "";
  const gate = Deno.env.get("FEST_GATE_PASSCODE") || "";
  if (admin && same(key, admin)) return "admin";
  if (gate && same(key, gate)) return "gate";
  const id = await sha256Hex(key);
  const hit = verified.get(id);
  if (hit && Date.now() - hit.at < 300_000) return hit.role;
  const { data } = await db.from("fest_keys").select("role,salt,hash,iterations");
  for (const row of data ?? []) {
    if (same(await hashPasscode(key, row.salt, row.iterations), row.hash)) {
      verified.set(id, { role: row.role as Role, at: Date.now() });
      return row.role as Role;
    }
  }
  return null;
}

/**
 * Checks the x-fest-key passcode. The admin passcode also opens the gate.
 * Ten wrong attempts from one address in ten minutes locks that address out for a while.
 */
export async function authorize(req: Request, need: Role): Promise<{ ok: true; role: Role } | { ok: false; res: Response }> {
  const who = await ipHash(req);
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await db.from("fest_auth_fails").select("id", { count: "exact", head: true }).eq("ip_hash", who).gte("at", since);
  if ((count ?? 0) >= 10) return { ok: false, res: json({ error: "locked" }, 429) };

  const key = (req.headers.get("x-fest-key") || "").trim();
  const role = key && key.length <= 200 ? await roleFor(key) : null;
  if (role === "admin" || (role === "gate" && need === "gate")) return { ok: true, role };

  await db.from("fest_auth_fails").insert({ ip_hash: who });
  return { ok: false, res: json({ error: "unauthorized" }, 401) };
}

/** Egyptian mobile numbers in one shape: 01XXXXXXXXX. Other numbers: digits only. */
export function normPhone(s: string): string {
  let d = String(s || "").replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c))).replace(/\D/g, "");
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("20") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith("1")) d = "0" + d;
  return d;
}

export async function getSettings() {
  const { data } = await db.from("fest_settings").select("*").eq("id", 1).single();
  return data as {
    price_egp: number;
    recipient_handles: string[];
    recipient_names: string[];
    recipient_phones: string[];
    sales_open: boolean;
    sales_start: string | null;
    capacity: number | null;
    pay_url: string | null;
    pay_handle: string | null;
    sponsors_url: string | null;
    event_start: string | null;
    event_end: string | null;
    venue_name: string | null;
    venue_detail: string | null;
    maps_url: string | null;
    contact_whatsapp: string | null;
  };
}

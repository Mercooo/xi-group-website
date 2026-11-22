// Public seat map for the theatre: 21 rows of left, middle and right blocks (festival/src/lib/theatre.json).
//   GET                                   → { taken, held, vip, blocked, locked: [...ids], phase, price, max }
//   POST { action: "hold", seats, token? } → holds the seats for the guest while they pay
//   POST { action: "release", token }      → lets them go again
// Seats are only "taken" for good when fest-buy (or a leader / admin) books them.
import { BROKEN_HOLD, NOT_IN_PLAN, PHASE_HOLD, PHASES, phaseOf, db, getSettings, HOLD_MINUTES, ipHash, json, MAX_SEATS, cleanSeats, CORS, VIP_HOLD } from "../_shared/shared.ts";

const TOKEN_RE = /^[a-f0-9]{32}$/;
const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function seatState() {
  const { data } = await db.from("fest_seats").select("id,order_id,held_until,hold_token");
  const now = Date.now();
  const taken: string[] = [], held: string[] = [], vip: string[] = [], blocked: string[] = [], locked: string[] = [];
  for (const s of data ?? []) {
    if (s.hold_token === NOT_IN_PLAN && !s.order_id) continue; // not part of the hall
    if (s.hold_token === BROKEN_HOLD) blocked.push(s.id);
    else if (s.order_id) taken.push(s.id);
    else if (s.hold_token === VIP_HOLD) vip.push(s.id); // shown on the plan, given out by the organisers only
    else if (s.hold_token === PHASE_HOLD) locked.push(s.id); // a phase that hasn't opened yet
    else if (s.held_until && Date.parse(s.held_until) > now) held.push(s.id);
  }
  // Open phases: those before the earliest phase that still has locked seats.
  const phase = locked.length ? Math.max(1, Math.min(...locked.map(phaseOf)) - 1) : PHASES.length;
  return { taken, held, vip, blocked, locked, phase, phases: PHASES };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (req.method === "GET") {
    const [state, s] = await Promise.all([seatState(), getSettings()]);
    return json({ ...state, price: s.price_egp, max: MAX_SEATS, hold_minutes: HOLD_MINUTES, sales_open: s.sales_open });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch (_) { return json({ error: "bad_request" }, 400); }

  if (b.action === "release") {
    const token = String(b.token || "");
    if (TOKEN_RE.test(token)) await db.from("fest_seats").update({ hold_token: null, hold_ip: null, held_until: null }).eq("hold_token", token).is("order_id", null);
    return json({ ok: true });
  }

  if (b.action === "hold") {
    const s = await getSettings();
    if (!s.sales_open) return json({ error: "sales_closed" }, 403);
    const seats = cleanSeats(b.seats);
    if (!seats) return json({ error: "bad_seats", max: MAX_SEATS }, 400);
    const token = TOKEN_RE.test(String(b.token || "")) ? String(b.token) : newToken();

    // One device can't sit on the whole theatre: at most 20 held seats per address.
    const who = await ipHash(req);
    const { count } = await db.from("fest_seats").select("id", { count: "exact", head: true })
      .eq("hold_ip", who).neq("hold_token", token).gt("held_until", new Date().toISOString());
    if ((count ?? 0) + seats.length > 20) return json({ error: "too_many_holds" }, 429);

    const { error } = await db.rpc("fest_hold_seats", { p_seats: seats, p_token: token, p_ip: who, p_minutes: HOLD_MINUTES });
    if (error) return json({ error: "seat_unavailable", ...(await seatState()) }, 409);
    return json({ ok: true, token, seats, expires_at: new Date(Date.now() + HOLD_MINUTES * 60_000).toISOString() });
  }

  return json({ error: "bad_action" }, 400);
});

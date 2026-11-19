// Leaders (cubs, troop, group…) book seats without InstaPay. Each leader has their own passcode
// (x-fest-key). Their bookings are verified at once and marked with who booked them.
// POST { action: "login" }                               → name, unit, quota, seats used
// POST { action: "book", seats, name, phone?, note? }    → a verified booking with a ticket per seat
// POST { action: "list" }                                → their bookings
// POST { action: "cancel", id }                          → frees the seats (not once anyone checked in)
import { authorizeLeader, claimSeats, cleanSeats, db, json, MAX_SEATS, newCode, normPhone, seatLabel, CORS } from "../_shared/shared.ts";

async function seatsUsed(leaderId: string) {
  const { data } = await db.from("fest_orders").select("qty").eq("leader_id", leaderId).neq("status", "rejected");
  return (data ?? []).reduce((n, r) => n + r.qty, 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = await authorizeLeader(req);
  if (!auth.ok) return auth.res;
  const leader = auth.leader;

  // deno-lint-ignore no-explicit-any
  let b: Record<string, any> = {};
  try { b = await req.json(); } catch (_) { return json({ error: "bad_request" }, 400); }

  if (b.action === "login") {
    return json({ ok: true, name: leader.name, unit: leader.unit, quota: leader.seat_quota, used: await seatsUsed(leader.id), max: MAX_SEATS });
  }

  if (b.action === "book") {
    const seats = cleanSeats(b.seats);
    if (!seats) return json({ error: "bad_seats", max: MAX_SEATS }, 400);
    const name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (name.length < 2) return json({ error: "bad_name" }, 400);
    const phone = normPhone(b.phone || "");
    if (leader.seat_quota != null) {
      const used = await seatsUsed(leader.id);
      if (used + seats.length > leader.seat_quota) return json({ error: "quota", quota: leader.seat_quota, used }, 409);
    }
    for (let i = 0; i < 3; i++) {
      const code = newCode();
      const { data: created, error } = await db.from("fest_orders").insert({
        code, name, phone: phone || "-", status: "verified", auto_verified: false, reasons: ["booked_by_leader"],
        seats, qty: seats.length, source: "leader", leader_id: leader.id,
        admin_note: [`${leader.unit}: ${leader.name}`, String(b.note || "").trim().slice(0, 200)].filter(Boolean).join(" · "),
        reviewed_at: new Date().toISOString(), reviewed_by: leader.name,
      }).select("id").single();
      if (error) { if (error.code === "23505") continue; return json({ error: "server" }, 500); }
      if (!(await claimSeats(created.id, seats, null))) {
        await db.from("fest_orders").delete().eq("id", created.id);
        return json({ error: "seat_unavailable" }, 409);
      }
      return json({ ok: true, code, seats: seats.map((s) => ({ id: s, label: seatLabel(s) })) });
    }
    return json({ error: "server" }, 500);
  }

  if (b.action === "list") {
    const { data } = await db.from("fest_orders").select("id,code,name,phone,seats,qty,created_at,status").eq("leader_id", leader.id).neq("status", "rejected").order("created_at", { ascending: false });
    return json({ rows: (data ?? []).map((o) => ({ ...o, seat_labels: (o.seats ?? []).map((s: string) => seatLabel(s)) })), used: await seatsUsed(leader.id), quota: leader.seat_quota });
  }

  if (b.action === "cancel") {
    const { data: o } = await db.from("fest_orders").select("id,leader_id").eq("id", b.id).maybeSingle();
    if (!o || o.leader_id !== leader.id) return json({ error: "not_found" }, 404);
    const { count } = await db.from("fest_seats").select("id", { count: "exact", head: true }).eq("order_id", o.id).not("checked_in_at", "is", null);
    if ((count ?? 0) > 0) return json({ error: "already_checked_in" }, 409);
    await db.rpc("fest_release_seats", { p_order: o.id });
    await db.from("fest_scans").update({ order_id: null }).eq("order_id", o.id);
    await db.from("fest_orders").delete().eq("id", o.id);
    return json({ ok: true });
  }

  return json({ error: "bad_action" }, 400);
});

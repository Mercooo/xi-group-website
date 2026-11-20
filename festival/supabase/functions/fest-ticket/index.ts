// Public endpoint, read-only.
//   GET ?config=1   → what the invitation page needs (price, InstaPay link, whether sales are open)
//   GET ?code=XXXX  → one ticket's state. The code is the secret printed in the QR; it is never listed.
//   GET ?read_token=…&sha=…  → redeems a one-time pass for the festival site's AI receipt reader
import { db, getSettings, isVipId, json, seatLabel, CORS } from "../_shared/shared.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const url = new URL(req.url);

  // /api/ocr on the festival site redeems a one-time pass before spending the AI key.
  if (url.searchParams.has("read_token")) {
    const token = (url.searchParams.get("read_token") || "").replace(/[^a-f0-9]/g, "").slice(0, 64);
    const sha = (url.searchParams.get("sha") || "").replace(/[^a-f0-9]/g, "").slice(0, 64);
    if (token.length < 32 || sha.length !== 64) return json({ ok: false });
    const since = new Date(Date.now() - 3 * 60_000).toISOString();
    const { data } = await db.from("fest_read_tokens").update({ used_at: new Date().toISOString() })
      .eq("token", token).eq("sha256", sha).is("used_at", null).gte("created_at", since).select("token").maybeSingle();
    return json({ ok: !!data });
  }

  if (url.searchParams.has("config")) {
    const s = await getSettings();
    let soldOut = false;
    if (s.capacity) {
      const { count } = await db.from("fest_orders").select("id", { count: "exact", head: true }).neq("status", "rejected");
      soldOut = (count ?? 0) >= s.capacity;
    }
    return json({
      price: s.price_egp,
      pay_url: s.pay_url,
      pay_handle: s.pay_handle,
      sponsors_url: s.sponsors_url,
      event_start: s.event_start,
      event_end: s.event_end,
      venue_name: s.venue_name,
      venue_detail: s.venue_detail,
      maps_url: s.maps_url,
      contact_whatsapp: s.contact_whatsapp,
      sales_open: s.sales_open && !soldOut,
      sold_out: soldOut,
      ready: !!s.pay_url && (s.recipient_handles.length + s.recipient_names.length + s.recipient_phones.length) > 0,
    });
  }

  const code = (url.searchParams.get("code") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length < 8 || code.length > 16) return json({ error: "bad_code" }, 400);
  const { data } = await db
    .from("fest_orders")
    .select("id,code,name,phone,status,reasons,created_at,checked_in_at,reviewed_at,ocr,seats,qty,source")
    .eq("code", code)
    .maybeSingle();
  if (!data) return json({ error: "not_found" }, 404);
  const s = await getSettings();
  // The receipt reader's notes are for the organisers. The guest only sees reasons once a person rejected the booking.
  const reasons = data.status === "rejected" ? (data.reasons ?? []).filter((r: string) => !r.startsWith("reader_")) : [];
  // Each seat is its own entry ticket. Its QR code is only handed out once the booking is verified.
  let seatTickets: { id: string; label_ar: string; label_en: string; code: string | null; checked_in_at: string | null; vip: boolean }[] = [];
  if ((data.seats ?? []).length) {
    const { data: rows } = await db.from("fest_seats").select("id,ticket_code,checked_in_at").eq("order_id", data.id).order("id");
    const held = new Map((rows ?? []).map((r) => [r.id, r]));
    seatTickets = (data.seats as string[]).map((id) => ({
      id,
      label_ar: seatLabel(id, "ar"),
      label_en: seatLabel(id, "en"),
      code: data.status === "verified" ? held.get(id)?.ticket_code ?? null : null,
      checked_in_at: held.get(id)?.checked_in_at ?? null,
      vip: isVipId(id),
    }));
  }
  return json({
    code: data.code,
    name: data.name,
    phone: data.phone.replace(/^(\d{3})\d+(\d{3})$/, "$1•••••$2"),
    status: data.status,
    reasons,
    seats: seatTickets,
    qty: data.qty,
    source: data.source,
    created_at: data.created_at,
    checked_in_at: data.checked_in_at,
    sponsors_url: s.sponsors_url,
    event_start: s.event_start,
    event_end: s.event_end,
    venue_name: s.venue_name,
    venue_detail: s.venue_detail,
    maps_url: s.maps_url,
    contact_whatsapp: s.contact_whatsapp,
  });
});

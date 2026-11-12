// Public endpoint, read-only.
//   GET ?config=1   → what the invitation page needs (price, InstaPay link, whether sales are open)
//   GET ?code=XXXX  → one ticket's state. The code is the secret printed in the QR; it is never listed.
import { db, getSettings, json, CORS } from "../_shared/shared.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const url = new URL(req.url);

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
    .select("code,name,phone,status,reasons,created_at,checked_in_at,reviewed_at")
    .eq("code", code)
    .maybeSingle();
  if (!data) return json({ error: "not_found" }, 404);
  const s = await getSettings();
  return json({
    code: data.code,
    name: data.name,
    phone: data.phone.replace(/^(\d{3})\d+(\d{3})$/, "$1•••••$2"),
    status: data.status,
    reasons: data.status === "verified" ? [] : data.reasons,
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

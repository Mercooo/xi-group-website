// Organisers' board. Needs the admin passcode in the x-fest-key header. POST { action, ... }:
//   stats | list { status?, q?, page? } | receipt { id } | set_status { id, status, note? }
//   undo_checkin { id } | issue { name, phone, note? } | settings_get | settings_set { ...fields } | scans
//   set_passcode { role: admin | gate, passcode } | delete { id }
import { authorize, BUCKET, db, forgetPasscodes, getSettings, hashPasscode, json, newSalt, normPhone, CORS, PASS_ITERATIONS } from "../_shared/shared.ts";

const PAGE = 50;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => [...crypto.getRandomValues(new Uint8Array(12))].map((x) => ALPHABET[x % 32]).join("");
const list = (v: unknown, max = 10) =>
  (Array.isArray(v) ? v : String(v ?? "").split(/[\n,]/)).map((s) => String(s).trim()).filter(Boolean).slice(0, max).map((s) => s.slice(0, 120));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = await authorize(req, "admin");
  if (!auth.ok) return auth.res;

  // deno-lint-ignore no-explicit-any
  let b: Record<string, any> = {};
  try { b = await req.json(); } catch (_) { return json({ error: "bad_request" }, 400); }

  switch (b.action) {
    case "stats": {
      const count = async (f: (q: any) => any) => (await f(db.from("fest_orders").select("id", { count: "exact", head: true }))).count ?? 0;
      const [verified, review, rejected, admitted, auto] = await Promise.all([
        count((q) => q.eq("status", "verified")),
        count((q) => q.eq("status", "review")),
        count((q) => q.eq("status", "rejected")),
        count((q) => q.not("checked_in_at", "is", null)),
        count((q) => q.eq("auto_verified", true)),
      ]);
      const s = await getSettings();
      return json({ verified, review, rejected, admitted, auto, revenue: verified * s.price_egp, price: s.price_egp });
    }

    case "list": {
      const page = Math.max(0, Number(b.page) || 0);
      const all = b.all === true;
      let q = db
        .from("fest_orders")
        .select("id,code,created_at,name,phone,email,affiliation,status,auto_verified,reasons,amount,reference,recipient,paid_at,receipt_path,reviewed_at,reviewed_by,admin_note,checked_in_at,checked_in_by", { count: "exact" })
        .order("created_at", { ascending: false });
      if (["verified", "review", "rejected"].includes(b.status)) q = q.eq("status", b.status);
      if (b.status === "checked_in") q = q.not("checked_in_at", "is", null);
      const term = String(b.q || "").trim().replace(/[%,()]/g, "").slice(0, 60);
      if (term) {
        const digits = normPhone(term);
        const ors = [`name.ilike.%${term}%`, `code.ilike.%${term.toUpperCase()}%`, `reference.ilike.%${term.toUpperCase()}%`];
        if (digits.length >= 4) ors.push(`phone.ilike.%${digits}%`);
        q = q.or(ors.join(","));
      }
      q = all ? q.range(0, 4999) : q.range(page * PAGE, page * PAGE + PAGE - 1);
      const { data, count, error } = await q;
      if (error) return json({ error: "server" }, 500);
      return json({ rows: data, total: count ?? 0, page, page_size: PAGE });
    }

    case "receipt": {
      const { data } = await db.from("fest_orders").select("receipt_path,ocr").eq("id", b.id).maybeSingle();
      if (!data?.receipt_path) return json({ error: "not_found" }, 404);
      const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(data.receipt_path, 300);
      return json({ url: signed?.signedUrl, ocr: data.ocr });
    }

    case "set_status": {
      if (!["verified", "review", "rejected"].includes(b.status)) return json({ error: "bad_status" }, 400);
      const patch: Record<string, unknown> = { status: b.status, reviewed_at: new Date().toISOString(), reviewed_by: "admin" };
      if (typeof b.note === "string") patch.admin_note = b.note.slice(0, 300);
      const { data, error } = await db.from("fest_orders").update(patch).eq("id", b.id).select("id,status").maybeSingle();
      if (error) return json({ error: error.code === "23505" ? "reference_used" : "server" }, error.code === "23505" ? 409 : 500);
      if (!data) return json({ error: "not_found" }, 404);
      return json({ ok: true, ...data });
    }

    case "delete": {
      // Remove a booking (spam, test, duplicate) together with its screenshot.
      const { data } = await db.from("fest_orders").select("id,receipt_path").eq("id", b.id).maybeSingle();
      if (!data) return json({ error: "not_found" }, 404);
      if (data.receipt_path) await db.storage.from(BUCKET).remove([data.receipt_path]);
      await db.from("fest_scans").update({ order_id: null }).eq("order_id", data.id);
      const { error } = await db.from("fest_orders").delete().eq("id", data.id);
      return error ? json({ error: "server" }, 500) : json({ ok: true });
    }

    case "undo_checkin": {
      const { error } = await db.from("fest_orders").update({ checked_in_at: null, checked_in_by: null }).eq("id", b.id);
      return error ? json({ error: "server" }, 500) : json({ ok: true });
    }

    case "issue": {
      // A ticket without an InstaPay transfer (cash, guests of honour, sponsors).
      const name = String(b.name || "").trim().slice(0, 80);
      const phone = normPhone(b.phone || "");
      if (name.length < 2) return json({ error: "bad_name" }, 400);
      for (let i = 0; i < 3; i++) {
        const code = newCode();
        const { error } = await db.from("fest_orders").insert({
          code, name, phone: phone || "-", status: "verified", reasons: ["issued_by_admin"],
          admin_note: String(b.note || "").slice(0, 300) || null, reviewed_at: new Date().toISOString(), reviewed_by: "admin",
        });
        if (!error) return json({ ok: true, code });
        if (error.code !== "23505") return json({ error: "server" }, 500);
      }
      return json({ error: "server" }, 500);
    }

    case "settings_get":
      return json(await getSettings());

    case "settings_set": {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.price_egp !== undefined) {
        const p = Number(b.price_egp);
        if (!Number.isFinite(p) || p <= 0 || p > 100000) return json({ error: "bad_price" }, 400);
        patch.price_egp = Math.round(p);
      }
      if (b.recipient_handles !== undefined) patch.recipient_handles = list(b.recipient_handles);
      if (b.recipient_names !== undefined) patch.recipient_names = list(b.recipient_names);
      if (b.recipient_phones !== undefined) patch.recipient_phones = list(b.recipient_phones);
      if (b.sales_open !== undefined) patch.sales_open = !!b.sales_open;
      if (b.sales_start !== undefined) patch.sales_start = /^\d{4}-\d{2}-\d{2}$/.test(b.sales_start) ? b.sales_start : null;
      if (b.capacity !== undefined) patch.capacity = Number(b.capacity) > 0 ? Math.round(Number(b.capacity)) : null;
      for (const k of ["event_start", "event_end"]) {
        if (b[k] === undefined) continue;
        const v = String(b[k] || "").trim();
        if (v && isNaN(Date.parse(v))) return json({ error: `bad_${k}` }, 400);
        patch[k] = v ? new Date(v).toISOString() : null;
      }
      for (const k of ["venue_name", "venue_detail"]) if (b[k] !== undefined) patch[k] = String(b[k] || "").trim().slice(0, 160) || null;
      if (b.contact_whatsapp !== undefined) patch.contact_whatsapp = normPhone(b.contact_whatsapp || "").replace(/^0/, "20") || null;
      for (const k of ["pay_url", "sponsors_url", "maps_url"]) {
        if (b[k] === undefined) continue;
        const v = String(b[k] || "").trim();
        if (v && !/^https:\/\/[^\s]+$/.test(v)) return json({ error: `bad_${k}` }, 400);
        patch[k] = v || null;
      }
      if (b.pay_handle !== undefined) patch.pay_handle = String(b.pay_handle || "").trim().slice(0, 80) || null;
      const { error } = await db.from("fest_settings").update(patch).eq("id", 1);
      return error ? json({ error: "server" }, 500) : json(await getSettings());
    }

    case "set_passcode": {
      // Change the admin or gate passcode. Stored only as a salted hash.
      const role = b.role === "gate" ? "gate" : b.role === "admin" ? "admin" : null;
      const pass = String(b.passcode || "").trim();
      if (!role) return json({ error: "bad_role" }, 400);
      if (pass.length < 8 || pass.length > 100) return json({ error: "weak_passcode" }, 400);
      const salt = newSalt();
      const hash = await hashPasscode(pass, salt);
      const { error } = await db.from("fest_keys").upsert({ role, salt, hash, iterations: PASS_ITERATIONS, updated_at: new Date().toISOString() });
      if (error) return json({ error: "server" }, 500);
      forgetPasscodes();
      return json({ ok: true, role });
    }

    case "scans": {
      const { data } = await db.from("fest_scans").select("at,code,result,gate").order("at", { ascending: false }).limit(100);
      return json({ rows: data ?? [] });
    }
  }
  return json({ error: "bad_action" }, 400);
});

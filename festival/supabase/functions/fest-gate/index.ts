// Gate check-in. Needs the gate (or admin) passcode in the x-fest-key header.
// POST { action: "login" }                     → checks the passcode
// POST { action: "scan", code, gate }          → admits a verified, unused ticket (atomically)
// POST { action: "stats" }                     → admitted / valid tickets so far
import { authorize, db, json, CORS } from "../_shared/shared.ts";

/** A QR may hold the ticket URL (…/t/CODE) or the bare code. */
function extractCode(raw: string) {
  const s = String(raw || "").trim();
  const m = s.match(/\/t\/([A-Za-z0-9]{8,16})/) || s.match(/[?&]c(?:ode)?=([A-Za-z0-9]{8,16})/);
  return (m ? m[1] : s).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = await authorize(req, "gate");
  if (!auth.ok) return auth.res;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { return json({ error: "bad_request" }, 400); }

  if (body.action === "login") return json({ ok: true, role: auth.role });

  if (body.action === "stats") {
    const [{ count: admitted }, { count: valid }] = await Promise.all([
      db.from("fest_orders").select("id", { count: "exact", head: true }).not("checked_in_at", "is", null),
      db.from("fest_orders").select("id", { count: "exact", head: true }).eq("status", "verified"),
    ]);
    return json({ admitted: admitted ?? 0, valid: valid ?? 0 });
  }

  if (body.action === "scan") {
    const code = extractCode(String(body.code || ""));
    const gate = String(body.gate || "gate").trim().slice(0, 40) || "gate";
    if (code.length < 8 || code.length > 16) {
      await db.from("fest_scans").insert({ code: code.slice(0, 64) || null, result: "unknown", gate });
      return json({ result: "unknown" });
    }
    const { data, error } = await db.rpc("fest_check_in", { p_code: code, p_gate: gate }).single();
    if (error) { console.error(error.message); return json({ error: "server" }, 500); }
    // deno-lint-ignore no-explicit-any
    const r = data as any;
    return json({ result: r.result, code, name: r.name, status: r.status, checked_in_at: r.checked_in_at, checked_in_by: r.checked_in_by });
  }

  return json({ error: "bad_action" }, 400);
});

import { API } from '../lib/site';

export interface PublicConfig {
  price: number;
  pay_url: string | null;
  pay_handle: string | null;
  sponsors_url: string | null;
  event_start: string | null;
  event_end: string | null;
  venue_name: string | null;
  venue_detail: string | null;
  maps_url: string | null;
  contact_whatsapp: string | null;
  sales_open: boolean;
  sold_out: boolean;
  ready: boolean;
}

export interface Ticket {
  code: string;
  name: string;
  phone: string;
  status: 'verified' | 'review' | 'rejected';
  reasons: string[];
  created_at: string;
  checked_in_at: string | null;
  sponsors_url: string | null;
  event_start: string | null;
  event_end: string | null;
  venue_name: string | null;
  venue_detail: string | null;
  maps_url: string | null;
  contact_whatsapp?: string | null;
}

export async function getConfig(): Promise<PublicConfig | null> {
  try {
    const r = await fetch(`${API}/fest-ticket?config=1`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function getTicket(code: string): Promise<{ ticket?: Ticket; error?: string }> {
  try {
    const r = await fetch(`${API}/fest-ticket?code=${encodeURIComponent(code)}`);
    const j = await r.json();
    return r.ok ? { ticket: j } : { error: j.error || 'error' };
  } catch {
    return { error: 'network' };
  }
}

/** Calls a passcode-protected function (fest-gate / fest-admin). */
export async function staff<T = any>(fn: 'fest-gate' | 'fest-admin', key: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  try {
    const r = await fetch(`${API}/${fn}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-fest-key': key },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({ error: 'bad_response' }));
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'network' } as any };
  }
}

const KEY = 'xi74-tickets';
export type SavedStatus = 'verified' | 'review' | 'rejected';
export function rememberTicket(code: string, name: string, status?: SavedStatus) {
  try {
    const all = savedTickets();
    const prev = all.find((t) => t.code === code);
    const list = all.filter((t) => t.code !== code);
    list.unshift({ code, name, at: prev?.at ?? Date.now(), status: status ?? prev?.status });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 12)));
  } catch {}
}
export function savedTickets(): { code: string; name: string; at: number; status?: SavedStatus }[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

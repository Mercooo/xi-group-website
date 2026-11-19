// Organisers' board: review receipts, issue tickets, edit settings, watch the gate.
import { reasonText } from '../lib/reasons';
import { staff } from './api';
import { formatDateTime } from './lang';
import { mountSeatMap, type SeatMap } from './seatmap';
import { MAX_SEATS, seatLabel, seatsSummary } from '../lib/seats';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const S_KEY = 'xi74-admin-key';
let key = sessionStorage.getItem(S_KEY) || '';
const api = (body: Record<string, unknown>) => staff('fest-admin', key, body);

const STATUS: Record<string, [string, string]> = {
  verified: ['مؤكدة', 'chip--ok'],
  review: ['مراجعة', 'chip--warn'],
  rejected: ['مرفوضة', 'chip--bad'],
};
const AFF: Record<string, string> = { member: 'عضو حالي', alumni: 'عضو قديم', leader: 'قائد', parent: 'ولي أمر', friend: 'صديق', guest: 'ضيف' };
const ticketUrl = (code: string) => `${location.origin}/t/${code}`;
const SOURCE: Record<string, string> = { instapay: 'إنستاباي', leader: 'حجز قائد', admin: 'إصدار يدوي' };
const sourceText = (o: any) => (o.source === 'leader' && o.fest_leaders ? `${o.fest_leaders.name} (${o.fest_leaders.unit})` : SOURCE[o.source] || '');
const el = (tag: string, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ----------------------------------------------------------------- login
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const k = $<HTMLInputElement>('#a-key').value.trim();
  const r = await staff('fest-admin', k, { action: 'stats' });
  const err = $('#login-err');
  if (!r.ok) {
    err.querySelector('span')!.textContent =
      { unauthorized: 'كلمة السر غير صحيحة.', locked: 'محاولات خاطئة كثيرة. انتظر عشر دقائق.', not_configured: 'لم تُضبط كلمة سر المنظمين بعد على الخادم.', network: 'تعذر الاتصال.' }[r.data.error || ''] || 'حدث خطأ.';
    err.hidden = false;
    return;
  }
  key = k;
  sessionStorage.setItem(S_KEY, k);
  start(r.data);
});
$('#logout').addEventListener('click', () => { sessionStorage.removeItem(S_KEY); location.reload(); });

// ------------------------------------------------------------------ tabs
document.querySelectorAll<HTMLElement>('[data-tab]').forEach((tab) =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
    if (tab.dataset.tab === 'settings') loadSettings();
    if (tab.dataset.tab === 'scans') loadScans();
    if (tab.dataset.tab === 'seats') loadSeatMap();
    if (tab.dataset.tab === 'issue') loadIssueMap();
    if (tab.dataset.tab === 'leaders') loadLeaders();
  }),
);

// ----------------------------------------------------------------- stats
function renderStats(s: any) {
  $('#k-verified').textContent = s.verified;
  $('#k-review').textContent = s.review;
  $('#k-rejected').textContent = s.rejected;
  $('#k-admitted').textContent = s.admitted;
  $('#k-revenue').textContent = Number(s.revenue).toLocaleString('en');
  $('#k-seats').textContent = `${s.seats_booked ?? 0}${s.seats_review ? ` +${s.seats_review}` : ''}`;
  $('#k-free').textContent = String(s.seats_free ?? '–');
  const b = $('#badge-review');
  b.textContent = s.review;
  b.hidden = !s.review;
}
let price = 100;
async function loadStats() {
  const r = await api({ action: 'stats' });
  if (r.ok) { renderStats(r.data); price = r.data.price ?? price; }
}

// ---------------------------------------------------------------- orders
let filter = '';
let page = 0;
let rows: any[] = [];
let qTimer = 0;

async function loadOrders() {
  const box = $('#orders');
  const r = await api({ action: 'list', status: filter, q: $<HTMLInputElement>('#q').value, page });
  if (r.status === 401) return $('#logout').click();
  box.textContent = '';
  if (!r.ok) { box.append(el('p', 'empty-list', 'تعذر تحميل الطلبات.')); return; }
  rows = r.data.rows;
  if (!rows.length) box.append(el('p', 'empty-list', filter || $<HTMLInputElement>('#q').value ? 'لا توجد نتائج.' : 'لا توجد طلبات بعد.'));
  for (const o of rows) {
    const b = el('button', 'order') as HTMLButtonElement;
    b.type = 'button';
    b.dataset.s = o.status;
    const main = el('div');
    main.append(el('div', 'order__name', o.name));
    const meta = el('div', 'order__meta');
    meta.append(el('span', 'mono', o.phone), el('span', '', formatDateTime(o.created_at, 'ar')));
    if (o.affiliation) meta.append(el('span', '', AFF[o.affiliation] || o.affiliation));
    if (o.reference) meta.append(el('span', 'mono', `#${o.reference}`));
    if (o.seats?.length) meta.append(el('span', '', `${o.seats.length} ${o.seats.length === 1 ? 'مقعد' : 'مقاعد'}: ${seatsSummary(o.seats, 'ar')}`));
    if (o.source && o.source !== 'instapay') meta.append(el('span', '', sourceText(o)));
    main.append(meta);
    if (o.status !== 'verified' && o.reasons?.length) main.append(el('div', 'order__meta', o.reasons.map((x: string) => reasonText(x, 'ar')).join(' · ')));
    const side = el('div', 'order__side');
    const [label, cls] = STATUS[o.status];
    side.append(el('span', `chip ${cls}`, label));
    if (o.checked_in_at) side.append(el('span', 'order__meta', `دخل ${formatDateTime(o.checked_in_at, 'ar')}`));
    else if (o.auto_verified) side.append(el('span', 'order__meta', 'تحقق آلي'));
    b.append(main, side);
    b.addEventListener('click', () => openOrder(o));
    box.append(b);
  }
  const total = r.data.total, size = r.data.page_size;
  $('#pager').hidden = total <= size;
  $('#page-info').textContent = `${page * size + 1}–${Math.min(total, (page + 1) * size)} من ${total}`;
  $<HTMLButtonElement>('#prev').disabled = page === 0;
  $<HTMLButtonElement>('#next').disabled = (page + 1) * size >= total;
}

document.querySelectorAll<HTMLElement>('.filter').forEach((f) =>
  f.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((x) => x.setAttribute('aria-pressed', String(x === f)));
    filter = f.dataset.f || '';
    page = 0;
    loadOrders();
  }),
);
$('#q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = window.setTimeout(() => { page = 0; loadOrders(); }, 350); });
$('#prev').addEventListener('click', () => { page = Math.max(0, page - 1); loadOrders(); });
$('#next').addEventListener('click', () => { page++; loadOrders(); });
$('#refresh').addEventListener('click', () => { loadStats(); loadOrders(); });

// --------------------------------------------------------- order detail
const sheet = $<HTMLDialogElement>('#sheet');
let open: any = null;
sheet.querySelector('[data-close]')!.addEventListener('click', () => sheet.close());
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

async function openOrder(o: any) {
  open = o;
  $('#sheet-title').textContent = o.name;
  const dl = $('#d-info');
  dl.textContent = '';
  const add = (k: string, v: string | null | undefined, mono = false) => {
    if (!v) return;
    dl.append(el('dt', '', k));
    dl.append(el('dd', mono ? 'mono' : '', v));
  };
  add('الحالة', STATUS[o.status][0] + (o.auto_verified ? ' (تحقق آلي)' : ''));
  add('رمز الحجز', o.code, true);
  add('المقاعد', o.seats?.length ? `${o.seats.length}: ${o.seats.map((x: string) => seatLabel(x, 'ar')).join('، ')}` : null);
  add('المصدر', sourceText(o));
  add('المطلوب', o.source === 'instapay' && o.seats?.length ? `${o.seats.length} × ${price} = ${o.seats.length * price} جنيه` : null);
  add('الموبايل', o.phone, true);
  add('البريد', o.email);
  add('الصلة', AFF[o.affiliation] || o.affiliation);
  add('تاريخ الطلب', formatDateTime(o.created_at, 'ar'));
  add('المبلغ المقروء', o.amount != null ? `${o.amount} جنيه` : null);
  add('المستلم المقروء', o.recipient);
  add('المرجع', o.reference, true);
  add('تاريخ التحويل', o.paid_at);
  add('الدخول', o.checked_in_at ? `${formatDateTime(o.checked_in_at, 'ar')} · ${o.checked_in_by || ''}` : null);
  add('روجعت', o.reviewed_at ? formatDateTime(o.reviewed_at, 'ar') : null);
  const rs = $('#d-reasons');
  rs.textContent = '';
  if (o.reasons?.length) {
    const ul = el('ul', 'reasons');
    for (const x of o.reasons) ul.append(el('li', '', reasonText(x, 'ar')));
    if (o.status !== 'rejected') ul.classList.add('reasons--warn');
    rs.append(ul);
  }
  $<HTMLInputElement>('#d-note').value = o.admin_note || '';
  $<HTMLAnchorElement>('#d-link').href = ticketUrl(o.code);
  const wa = o.phone && o.phone !== '-' ? o.phone.replace(/^0/, '20') : '';
  const waLink = $<HTMLAnchorElement>('#d-wa');
  waLink.hidden = !wa;
  waLink.href = `https://wa.me/${wa}?text=${encodeURIComponent(`أهلاً ${o.name}، هذه تذكرتك لعيد الـ74 للمجموعة الحادية عشر: ${ticketUrl(o.code)}`)}`;
  $('#d-undo').hidden = !o.checked_in_at;
  $('#d-told').hidden = true;
  document.querySelectorAll<HTMLButtonElement>('[data-set]').forEach((b) => (b.disabled = b.dataset.set === o.status));

  const img = $<HTMLImageElement>('#d-img');
  img.hidden = true;
  img.removeAttribute('src');
  $('#d-noimg').hidden = !!o.receipt_path;
  sheet.showModal();
  if (o.receipt_path) {
    const r = await api({ action: 'receipt', id: o.id });
    if (r.ok && open === o) {
      img.src = r.data.url;
      img.hidden = false;
      const engine = r.data.ocr?.model ? String(r.data.ocr.model) : r.data.ocr?.error ? 'لم يُقرأ آلياً' : '';
      if (engine) {
        dl.append(el('dt', '', 'قرأه'));
        dl.append(el('dd', '', engine === 'tesseract' ? 'OCR مجاني (بدون ذكاء اصطناعي)' : engine));
      }
    }
  }
}

// Ready-made WhatsApp messages so the guest hears the decision without waiting on the page.
const waTo = (phone: string) => (phone && phone !== '-' ? phone.replace(/^0/, '20') : '');
function decisionMessage(o: any, status: string) {
  const link = ticketUrl(o.code);
  if (status === 'verified') return `أهلاً ${o.name}، تم قبول حجزك لعيد الـ74 للمجموعة الحادية عشر 🎉\n${o.seats?.length ? `مقاعدك: ${o.seats.map((x: string) => seatLabel(x, 'ar')).join('، ')}\n` : ''}تذاكرك برمز QR (ويمكن تحميلها PDF للطباعة)، قدّمها على البوابة:\n${link}`;
  if (status === 'rejected') return `أهلاً ${o.name}، للأسف لم نتمكن من قبول إيصال التحويل لحجزك في عيد الـ74.\nالتفاصيل في صفحة الحجز:\n${link}\nإن كنت حوّلت المبلغ الصحيح، ردّ على هذه الرسالة بصورة أوضح للإيصال.`;
  return '';
}

document.querySelectorAll<HTMLButtonElement>('[data-set]').forEach((b) =>
  b.addEventListener('click', async () => {
    if (!open) return;
    const status = b.dataset.set!;
    if (status === 'rejected' && !confirm(`رفض هذا الطلب؟ لن تصبح التذكرة صالحة للدخول${open.seats?.length ? '، وستعود مقاعده متاحة للحجز' : ''}.`)) return;
    b.disabled = true;
    const r = await api({ action: 'set_status', id: open.id, status, note: $<HTMLInputElement>('#d-note').value });
    if (!r.ok) { b.disabled = false; return alert(r.data.error === 'reference_used' ? 'يوجد طلب آخر مؤكد بنفس رقم المرجع.' : r.data.error === 'seats_taken' ? 'لا يمكن: مقاعد هذا الطلب حُجزت لشخص آخر بعد رفضه.' : 'تعذر الحفظ.'); }
    open.status = status;
    document.querySelectorAll<HTMLButtonElement>('[data-set]').forEach((x) => (x.disabled = x.dataset.set === status));
    // Tell the organiser the guest's page already updated, and offer to message them now.
    const told = $('#d-told');
    const msg = decisionMessage(open, status);
    const to = waTo(open.phone);
    told.hidden = !msg;
    if (msg) {
      $('#d-told-text').textContent = status === 'verified'
        ? 'تم القبول. صفحة الضيف تعرض تذكرته الآن تلقائياً.'
        : 'تم الرفض. صفحة الضيف تعرض السبب الآن تلقائياً.';
      const wa = $<HTMLAnchorElement>('#d-told-wa');
      wa.hidden = !to;
      wa.href = `https://wa.me/${to}?text=${encodeURIComponent(msg)}`;
    }
    loadStats();
    loadOrders();
  }),
);
$('#d-undo').addEventListener('click', async () => {
  if (!open || !confirm('إلغاء تسجيل دخول هذه التذكرة؟ ستصبح صالحة للدخول مرة أخرى.')) return;
  const r = await api({ action: 'undo_checkin', id: open.id });
  if (r.ok) { sheet.close(); loadStats(); loadOrders(); }
});

$('#d-delete').addEventListener('click', async () => {
  if (!open || !confirm(`حذف طلب «${open.name}» نهائياً مع صورة الإيصال؟ لا يمكن التراجع.`)) return;
  const r = await api({ action: 'delete', id: open.id });
  if (!r.ok) return alert('تعذر الحذف.');
  sheet.close();
  loadStats();
  loadOrders();
});

// ------------------------------------------------------------------ CSV
$('#csv').addEventListener('click', async () => {
  const r = await api({ action: 'list', status: filter, q: $<HTMLInputElement>('#q').value, all: true });
  if (!r.ok) return alert('تعذر التصدير.');
  const cols = ['code', 'name', 'phone', 'email', 'affiliation', 'status', 'qty', 'seats', 'source', 'auto_verified', 'amount', 'reference', 'recipient', 'paid_at', 'created_at', 'checked_in_at', 'checked_in_by', 'admin_note', 'reasons'];
  const cell = (v: unknown) => {
    let s = Array.isArray(v) ? v.join(' | ') : v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // keep spreadsheets from running formulas
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = '﻿' + [cols.join(','), ...r.data.rows.map((row: any) => cols.map((c) => cell(row[c])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `xi-74-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------------------------------------------------------------- issue
$('#issue-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api({ action: 'issue', name: $<HTMLInputElement>('#i-name').value, phone: $<HTMLInputElement>('#i-phone').value, note: $<HTMLInputElement>('#i-note').value, seats: issueSeats });
  const box = $('#issued');
  box.hidden = false;
  const span = box.querySelector('span')!;
  span.textContent = '';
  if (!r.ok) { box.className = 'notice notice--bad'; span.textContent = r.data.error === 'seat_unavailable' ? 'أحد المقاعد حُجز للتو. اختر غيره.' : 'تعذر إصدار التذكرة.'; loadIssueMap(); return; }
  box.className = 'notice notice--ok';
  span.append('صدرت التذكرة: ');
  const a = el('a', 'mono', ticketUrl(r.data.code)) as HTMLAnchorElement;
  a.href = ticketUrl(r.data.code);
  a.target = '_blank';
  span.append(a);
  (e.target as HTMLFormElement).reset();
  issueSeats = [];
  loadIssueMap();
  loadStats();
});

// -------------------------------------------------------------- settings
const form = $<HTMLFormElement>('#settings-form');
const LISTS = ['recipient_handles', 'recipient_names', 'recipient_phones'];
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  // Cairo local time for the datetime-local inputs.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
};
/** Interprets a datetime-local value as Cairo time. */
const fromCairo = (v: string) => {
  if (!v) return '';
  const asUtc = new Date(v + 'Z');
  const cairo = new Date(asUtc.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const utc = new Date(asUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(asUtc.getTime() - (cairo.getTime() - utc.getTime())).toISOString();
};

async function loadSettings() {
  const r = await api({ action: 'settings_get' });
  if (!r.ok) return;
  const s = r.data;
  for (const elx of Array.from(form.elements) as HTMLInputElement[]) {
    if (!elx.name) continue;
    const v = s[elx.name];
    if (elx.type === 'checkbox') elx.checked = !!v;
    else if (LISTS.includes(elx.name)) elx.value = (v || []).join('\n');
    else if (elx.type === 'datetime-local') elx.value = toLocalInput(v);
    else if (elx.name === 'contact_whatsapp') elx.value = v ? String(v).replace(/^20/, '0') : '';
    else elx.value = v ?? '';
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body: Record<string, unknown> = { action: 'settings_set' };
  for (const elx of Array.from(form.elements) as HTMLInputElement[]) {
    if (!elx.name) continue;
    if (elx.type === 'checkbox') body[elx.name] = elx.checked;
    else if (LISTS.includes(elx.name)) body[elx.name] = elx.value.split('\n').map((x) => x.trim()).filter(Boolean);
    else if (elx.type === 'datetime-local') body[elx.name] = fromCairo(elx.value);
    else body[elx.name] = elx.value.trim();
  }
  const r = await api(body);
  const err = $('#settings-err');
  if (!r.ok) {
    err.querySelector('span')!.textContent = { bad_price: 'الثمن غير صحيح.', bad_pay_url: 'رابط الدفع يجب أن يبدأ بـ https://', bad_sponsors_url: 'رابط العروض يجب أن يبدأ بـ https://', bad_maps_url: 'رابط الخريطة يجب أن يبدأ بـ https://' }[r.data.error || ''] || 'تعذر الحفظ.';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  loadSettings();
  const t = el('div', 'toast', 'تم حفظ الإعدادات');
  document.body.append(t);
  setTimeout(() => t.remove(), 2000);
});

// --------------------------------------------------------------- passcodes
$('#pass-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const role = $<HTMLSelectElement>('#p-role').value;
  const input = $<HTMLInputElement>('#p-new');
  const msg = $('#pass-msg');
  const r = await api({ action: 'set_passcode', role, passcode: input.value });
  msg.hidden = false;
  if (!r.ok) {
    msg.className = 'notice notice--bad';
    msg.querySelector('span')!.textContent = r.data.error === 'weak_passcode' ? 'كلمة السر يجب أن تكون 8 أحرف على الأقل.' : 'تعذر الحفظ.';
    return;
  }
  msg.className = 'notice notice--ok';
  msg.querySelector('span')!.textContent = role === 'admin' ? 'تم تغيير كلمة سر المنظمين. استخدمها في المرة القادمة.' : 'تم تغيير كلمة سر البوابة. أعطها لفريق البوابة.';
  input.value = '';
  if (role === 'admin') { key = ''; sessionStorage.removeItem(S_KEY); }
});

// ------------------------------------------------------------------ scans
const SCAN: Record<string, string> = { admitted: '✓ دخل', already_used: '! مستخدمة', not_verified: '✕ غير مؤكدة', unknown: '✕ غير معروفة', seat_ticket_required: '! رمز الحجز بدل تذكرة المقعد' };
async function loadScans() {
  const r = await api({ action: 'scans' });
  const body = $('#scans-body');
  body.textContent = '';
  if (!r.ok) return;
  for (const s of r.data.rows) {
    const tr = el('tr');
    tr.append(el('td', '', formatDateTime(s.at, 'ar')), el('td', '', SCAN[s.result] || s.result), el('td', 'mono', s.code || ''), el('td', '', s.gate || ''));
    body.append(tr);
  }
  if (!r.data.rows.length) { const tr = el('tr'); const td = el('td', '', 'لا توجد عمليات مسح بعد.'); (td as HTMLTableCellElement).colSpan = 4; tr.append(td); body.append(tr); }
}
$('#scans-refresh').addEventListener('click', loadScans);

// ------------------------------------------------------------------ seats
let adminMap: SeatMap | null = null;
let seatRows = new Map<string, any>();
const SEAT_STATE: Record<string, string> = { verified: 'مؤكد', review: 'قيد المراجعة', rejected: 'مرفوض', held: 'يُحجز الآن (لم يكمل الدفع)', free: 'متاح' };

async function loadSeatMap() {
  adminMap ??= mountSeatMap($('#admin-map'), showSeatInfo, { pickAny: true });
  const r = await api({ action: 'seat_map' });
  if (!r.ok) return;
  seatRows = new Map(r.data.seats.map((x: any) => [x.id, x]));
  for (const x of r.data.seats) {
    const st = x.in ? 'in' : x.state === 'verified' ? 'taken' : x.state === 'review' ? 'review' : x.state === 'held' ? 'held' : 'free';
    adminMap.set(x.id, st, x.name ? `${x.name}${x.source === 'leader' ? ' · قائد' : x.source === 'admin' ? ' · يدوي' : ''}` : undefined);
  }
}
$('#seats-refresh').addEventListener('click', loadSeatMap);

function showSeatInfo(id: string) {
  const x = seatRows.get(id);
  const box = $('#seat-info');
  box.hidden = false;
  box.textContent = '';
  box.append(el('h2', '', seatLabel(id, 'ar')));
  const dl = el('dl', 'dl');
  const add = (k: string, v: string) => { dl.append(el('dt', '', k), el('dd', '', v)); };
  add('الحالة', x?.in ? 'دخل صاحبه' : SEAT_STATE[x?.state ?? 'free'] ?? x?.state);
  if (x?.name) add('الاسم', x.name);
  if (x?.source) add('المصدر', SOURCE[x.source] ?? x.source);
  box.append(dl);
  if (x?.code) {
    const a = el('a', 'btn btn--sm btn--ghost', 'فتح الطلب') as HTMLAnchorElement;
    a.href = '#';
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      const r = await api({ action: 'list', q: x.code });
      const o = r.ok ? r.data.rows.find((row: any) => row.code === x.code) : null;
      if (o) openOrder(o);
    });
    const t = el('a', 'btn btn--sm btn--ghost', 'صفحة التذاكر') as HTMLAnchorElement;
    t.href = ticketUrl(x.code);
    t.target = '_blank';
    const row = el('div', 'actions');
    row.style.marginTop = '10px';
    row.append(a, t);
    box.append(row);
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Seats for a manually issued ticket.
let issueMap: SeatMap | null = null;
let issueSeats: string[] = [];
let issueTaken = new Set<string>();
function paintIssue() {
  if (!issueMap) return;
  for (const id of issueMap.ids()) issueMap.set(id, issueSeats.includes(id) ? 'selected' : issueTaken.has(id) ? 'taken' : 'free');
  $('#issue-seats').textContent = issueSeats.length ? `${issueSeats.length}: ${seatsSummary(issueSeats, 'ar')}` : 'لم تُختر مقاعد.';
}
async function loadIssueMap() {
  issueMap ??= mountSeatMap($('#issue-map'), (id) => {
    if (issueSeats.includes(id)) issueSeats = issueSeats.filter((x) => x !== id);
    else if (issueSeats.length < MAX_SEATS) issueSeats = [...issueSeats, id].sort();
    paintIssue();
  });
  const r = await api({ action: 'seat_map' });
  if (!r.ok) return;
  issueTaken = new Set(r.data.seats.filter((x: any) => x.state !== 'free').map((x: any) => x.id));
  issueSeats = issueSeats.filter((id) => !issueTaken.has(id));
  paintIssue();
}

// ---------------------------------------------------------------- leaders
let leaders: any[] = [];
async function loadLeaders() {
  const r = await api({ action: 'leaders_list' });
  const box = $('#leaders');
  box.textContent = '';
  if (!r.ok) { box.append(el('p', 'empty-list', 'تعذر التحميل.')); return; }
  leaders = r.data.rows;
  if (!leaders.length) box.append(el('p', 'empty-list', 'لا توجد حسابات قادة بعد.'));
  for (const l of leaders) {
    const b = el('button', 'order') as HTMLButtonElement;
    b.type = 'button';
    b.dataset.s = l.active ? 'verified' : 'rejected';
    const main = el('div');
    main.append(el('div', 'order__name', l.name));
    main.append(el('div', 'order__meta', `${l.unit} · حجز ${l.seats_used} ${l.seat_quota ? `من ${l.seat_quota}` : ''} مقعد`));
    const side = el('div', 'order__side');
    side.append(el('span', `chip ${l.active ? 'chip--ok' : 'chip--bad'}`, l.active ? 'مفعّل' : 'موقوف'));
    b.append(main, side);
    b.addEventListener('click', () => editLeader(l));
    box.append(b);
  }
}
function editLeader(l: any | null) {
  $<HTMLInputElement>('#lf-id').value = l?.id ?? '';
  $<HTMLInputElement>('#lf-name').value = l?.name ?? '';
  $<HTMLInputElement>('#lf-unit').value = l?.unit ?? '';
  $<HTMLInputElement>('#lf-pass').value = '';
  $<HTMLInputElement>('#lf-quota').value = l?.seat_quota ?? '';
  $<HTMLInputElement>('#lf-active').checked = l ? !!l.active : true;
  $('#lf-title').textContent = l ? `تعديل: ${l.name}` : 'قائد جديد';
  $('#lf-pass-hint').textContent = l ? '(اتركها فارغة لعدم تغييرها)' : '(8 أحرف على الأقل)';
  $('#lf-new').hidden = !l;
  $('#lf-msg').hidden = true;
  $('#leader-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
$('#lf-new').addEventListener('click', () => editLeader(null));
$('#lf-gen').addEventListener('click', () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(12));
  const s = [...r].map((x) => A[x % 32]).join('');
  $<HTMLInputElement>('#lf-pass').value = `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
});
$('#leader-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $<HTMLInputElement>('#lf-id').value;
  const pass = $<HTMLInputElement>('#lf-pass').value.trim();
  const r = await api({
    action: 'leader_save', id: id || undefined,
    name: $<HTMLInputElement>('#lf-name').value, unit: $<HTMLInputElement>('#lf-unit').value,
    passcode: pass || undefined, seat_quota: $<HTMLInputElement>('#lf-quota').value || null,
    active: $<HTMLInputElement>('#lf-active').checked,
  });
  const msg = $('#lf-msg');
  msg.hidden = false;
  if (!r.ok) {
    msg.className = 'notice notice--bad';
    msg.querySelector('span')!.textContent = { weak_passcode: 'كلمة السر يجب أن تكون 8 أحرف على الأقل.', bad_leader: 'اكتب الاسم والوحدة.' }[r.data.error || ''] || 'تعذر الحفظ.';
    return;
  }
  msg.className = 'notice notice--ok';
  msg.querySelector('span')!.textContent = pass ? `تم الحفظ. كلمة السر: ${pass} — احفظها وأعطها للقائد، لن تظهر مرة أخرى.` : 'تم الحفظ.';
  $<HTMLInputElement>('#lf-id').value = r.data.id;
  $<HTMLInputElement>('#lf-pass').value = '';
  loadLeaders();
});

// ------------------------------------------------------------------ start
let auto = 0;
function start(stats?: any) {
  $('#login').hidden = true;
  $('#app').hidden = false;
  if (stats) { renderStats(stats); price = stats.price ?? price; } else loadStats();
  loadOrders();
  clearInterval(auto);
  auto = window.setInterval(() => {
    if (sheet.open || document.visibilityState !== 'visible') return;
    loadStats(); loadOrders();
    if (!$('[data-panel="seats"]').hidden) loadSeatMap();
  }, 30_000);
}
if (key) api({ action: 'stats' }).then((r) => (r.ok ? start(r.data) : sessionStorage.removeItem(S_KEY)));

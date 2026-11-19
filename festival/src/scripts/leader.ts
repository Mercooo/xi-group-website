// Leaders' booking page (/leader): seats for a unit's members and families, without InstaPay.
// Each leader signs in with their own passcode; bookings are verified at once.
import { API } from '../lib/site';
import { MAX_SEATS, seatLabel } from '../lib/seats';
import { staff } from './api';
import { mountSeatMap } from './seatmap';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const S_KEY = 'xi74-leader-key';
let key = sessionStorage.getItem(S_KEY) || '';
const api = (body: Record<string, unknown>) => staff('fest-leader', key, body);

let me: { name: string; unit: string; quota: number | null; used: number } | null = null;
let chosen: string[] = [];
let state: { taken: string[]; held: string[] } = { taken: [], held: [] };

const ERR: Record<string, string> = {
  unauthorized: 'كلمة السر غير صحيحة.',
  locked: 'محاولات خاطئة كثيرة. انتظر عشر دقائق ثم حاول.',
  network: 'تعذر الاتصال. تأكد من الإنترنت.',
  bad_seats: 'اختر من 1 إلى 10 مقاعد.',
  bad_name: 'اكتب اسم صاحب الحجز.',
  seat_unavailable: 'أحد المقاعد حُجز للتو. تم تحديث الخريطة، اختر غيره.',
  quota: 'تجاوزت عدد المقاعد المخصص لك. تواصل مع المنظمين.',
  already_checked_in: 'لا يمكن الإلغاء: دخل أحد أصحاب هذا الحجز بالفعل.',
  server: 'حدث خطأ. حاول مرة أخرى.',
};
const errText = (code?: string) => ERR[code || 'server'] ?? ERR.server;

// ------------------------------------------------------------------ login
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const k = $<HTMLInputElement>('#l-key').value.trim();
  if (!k) return;
  key = k;
  const r = await api({ action: 'login' });
  const err = $('#login-err');
  if (!r.ok) {
    err.hidden = false;
    err.querySelector('span')!.textContent = errText(r.data.error);
    key = '';
    return;
  }
  sessionStorage.setItem(S_KEY, key);
  start(r.data);
});

$('#logout').addEventListener('click', () => {
  sessionStorage.removeItem(S_KEY);
  location.reload();
});

// ------------------------------------------------------------------- map
const map = mountSeatMap($('#seatmap'), (id) => {
  if (chosen.includes(id)) chosen = chosen.filter((x) => x !== id);
  else if (chosen.length >= MAX_SEATS) return showErr(`حتى ${MAX_SEATS} مقاعد في الحجز الواحد. احجزها ثم ابدأ حجزاً جديداً.`);
  else chosen = [...chosen, id].sort();
  showErr('');
  paint();
  renderChosen();
});

function paint() {
  const taken = new Set(state.taken), held = new Set(state.held);
  for (const id of map.ids()) map.set(id, chosen.includes(id) ? 'selected' : taken.has(id) ? 'taken' : held.has(id) ? 'held' : 'free');
}

async function refreshSeats() {
  try {
    const r = await fetch(`${API}/fest-seats`);
    if (!r.ok) return;
    const j = await r.json();
    state = { taken: j.taken ?? [], held: j.held ?? [] };
    chosen = chosen.filter((id) => !state.taken.includes(id));
    paint();
    renderChosen();
  } catch {}
}

function renderChosen() {
  const n = chosen.length;
  $('#chosen').classList.toggle('chosen--empty', !n);
  $('#chosen-empty').hidden = !!n;
  $('#chosen-top').hidden = $('#chosen-list').hidden = !n;
  $('#chosen-count').textContent = `${n} ${n === 1 ? 'مقعد' : n === 2 ? 'مقعدان' : 'مقاعد'}`;
  $('#chosen-list').replaceChildren(...chosen.map((id) => Object.assign(document.createElement('span'), { textContent: seatLabel(id, 'ar') })));
}
$('#clear').addEventListener('click', () => { chosen = []; paint(); renderChosen(); });

function renderQuota() {
  if (!me) return;
  $('#quota').textContent = me.quota ? `حجزت ${me.used} من ${me.quota} مقعداً` : `حجزت ${me.used} ${me.used === 1 ? 'مقعداً' : 'مقاعد'} حتى الآن`;
}

function showErr(msg: string) {
  const b = $('#book-err');
  b.hidden = !msg;
  b.querySelector('span')!.textContent = msg;
}

// ------------------------------------------------------------------ book
const ticketLink = (code: string) => `${location.origin}/t/${code}`;

$('#book-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showErr('');
  const name = $<HTMLInputElement>('#b-name').value.trim();
  $('#book-form').querySelector('[data-err="name"]')!.textContent = name.length < 2 ? 'اكتب اسم صاحب الحجز.' : '';
  if (!chosen.length) return showErr('اختر المقاعد من الخريطة أولاً.');
  if (name.length < 2) return;
  const btn = $<HTMLButtonElement>('#book-btn');
  btn.disabled = true;
  const r = await api({ action: 'book', seats: chosen, name, phone: $<HTMLInputElement>('#b-phone').value.trim(), note: $<HTMLInputElement>('#b-note').value.trim() });
  btn.disabled = false;
  if (!r.ok) {
    if (r.status === 401) return location.reload();
    showErr(errText(r.data.error));
    if (r.data.error === 'seat_unavailable') refreshSeats();
    return;
  }
  const seats: { label: string }[] = r.data.seats;
  $('#done-text').textContent = `تم حجز ${seats.length === 1 ? 'مقعد' : `${seats.length} مقاعد`} باسم ${name}: ${seats.map((s) => s.label).join('، ')}`;
  $('#done-code').textContent = r.data.code;
  const link = ticketLink(r.data.code);
  $<HTMLAnchorElement>('#done-open').href = link;
  const msg = `تذاكر عيد الـ74 للمجموعة الحادية عشر باسم ${name}\n${seats.map((s) => s.label).join('، ')}\n${link}`;
  const phone = $<HTMLInputElement>('#b-phone').value.replace(/\D/g, '').replace(/^0/, '20');
  $<HTMLAnchorElement>('#done-wa').href = `https://wa.me/${phone.length >= 11 ? phone : ''}?text=${encodeURIComponent(msg)}`;
  $('#done-copy').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('تم نسخ الرابط'); } catch {} };
  $('#book-form').hidden = true;
  $('#done').hidden = false;
  chosen = [];
  await Promise.all([refreshSeats(), loadMine()]);
});

$('#done-new').addEventListener('click', () => {
  ($('#book-form') as HTMLFormElement).reset();
  $('#book-form').hidden = false;
  $('#done').hidden = true;
  renderChosen();
});

// ------------------------------------------------------------- my bookings
async function loadMine() {
  const r = await api({ action: 'list' });
  if (!r.ok) return;
  if (me) { me.used = r.data.used; renderQuota(); }
  const box = $('#mine');
  const rows: any[] = r.data.rows ?? [];
  if (!rows.length) {
    box.replaceChildren(Object.assign(document.createElement('p'), { className: 'list-empty', textContent: 'لا حجوزات بعد.' }));
    return;
  }
  box.replaceChildren(...rows.map((o) => {
    const d = document.createElement('div');
    d.className = 'bk';
    const top = document.createElement('div');
    top.className = 'bk__top';
    top.append(Object.assign(document.createElement('span'), { textContent: o.name }), Object.assign(document.createElement('span'), { className: 'mono', textContent: o.code, style: 'font-size:.8125rem;color:var(--muted)' }));
    const seats = Object.assign(document.createElement('div'), { className: 'bk__seats', textContent: (o.seat_labels ?? []).join('، ') });
    const actions = document.createElement('div');
    actions.className = 'bk__actions';
    const open = Object.assign(document.createElement('a'), { className: 'btn btn--ghost', href: ticketLink(o.code), target: '_blank', rel: 'noopener', textContent: 'التذاكر' });
    const cancel = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn--ghost', textContent: 'إلغاء الحجز' });
    cancel.style.color = 'var(--bad)';
    cancel.addEventListener('click', async () => {
      if (!confirm(`إلغاء حجز ${o.name}؟ ستعود المقاعد متاحة للحجز.`)) return;
      cancel.disabled = true;
      const c = await api({ action: 'cancel', id: o.id });
      if (!c.ok) { cancel.disabled = false; return alert(errText(c.data.error)); }
      toast('تم إلغاء الحجز');
      await Promise.all([loadMine(), refreshSeats()]);
    });
    actions.append(open, cancel);
    d.append(top, seats, actions);
    return d;
  }));
}

function toast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

function start(d: any) {
  me = { name: d.name, unit: d.unit, quota: d.quota, used: d.used };
  $('#hello').textContent = `أهلاً ${d.name} · ${d.unit}`;
  renderQuota();
  $('#login').hidden = true;
  $('#app').hidden = false;
  refreshSeats();
  loadMine();
  setInterval(() => { if (document.visibilityState === 'visible') refreshSeats(); }, 15_000);
}

if (key) api({ action: 'login' }).then((r) => (r.ok ? start(r.data) : sessionStorage.removeItem(S_KEY)));

// Invitation page: live event details, the InstaPay box and the booking form.
import { API, SPONSORS_URL } from '../lib/site';
import { getConfig, getTicket, rememberTicket, savedTickets, type PublicConfig } from './api';
import { formatDate, formatTime, lang, t } from './lang';
import { mountSeatMap } from './seatmap';
import { MAX_SEATS, isBlockedSeat, isVipSeat, seatLabel, seatsSummary } from '../lib/seats';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
let cfg: PublicConfig | null = null;

// ------------------------------------------------------------- event details
function renderConfig() {
  if (!cfg) return;
  document.querySelectorAll('[data-price]').forEach((el) => (el.textContent = String(cfg!.price)));
  renderChosen();

  if (cfg.event_start) {
    const when = `${formatDate(cfg.event_start)} · ${formatTime(cfg.event_start)}`;
    $('#fact-date').textContent = when;
  }
  if (cfg.venue_name) {
    const v = $('#fact-venue');
    v.textContent = '';
    if (cfg.maps_url) {
      const a = document.createElement('a');
      a.href = cfg.maps_url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.style.color = 'inherit';
      a.textContent = cfg.venue_name;
      v.append(a);
    } else v.textContent = cfg.venue_name;
  }

  const pay = $<HTMLAnchorElement>('#pay-link');
  if (cfg.pay_url) {
    pay.href = cfg.pay_url;
    pay.removeAttribute('aria-disabled');
    $('#pay-soon').hidden = true;
  } else {
    pay.removeAttribute('href');
  }
  if (cfg.pay_handle) {
    $('#pay-handle').textContent = cfg.pay_handle;
    $('#handle-row').hidden = false;
  }
  if (cfg.sponsors_url) $<HTMLAnchorElement>('#sponsors-link').href = cfg.sponsors_url;
  if (cfg.contact_whatsapp) {
    const wa = $<HTMLAnchorElement>('#wa-link');
    wa.href = `https://wa.me/${cfg.contact_whatsapp}`;
    wa.hidden = false;
  }

  // Booking closed / sold out / not set up yet.
  const closed = !cfg.sales_open || !cfg.pay_url;
  $('#buy-form').hidden = closed;
  $('#picker-bar').hidden = closed;
  salesClosed = closed;
  $('#closed').hidden = !closed;
  if (closed) {
    $('#closed-title').textContent = cfg.sold_out ? t('نفدت التذاكر', 'Sold out') : !cfg.pay_url ? t('الحجز يفتح قريباً', 'Booking opens soon') : t('الحجز مغلق حالياً', 'Booking is closed');
    $('#closed-text').textContent = cfg.sold_out
      ? t('اكتمل العدد المتاح للاحتفال. شكراً لمحبتكم!', 'Every place has been taken. Thank you!')
      : t('تابع صفحات المجموعة على فيسبوك وإنستجرام لمعرفة موعد فتح الحجز.', 'Follow the group on Facebook and Instagram to hear when booking opens.');
  }
  startCountdown();
}

let timer = 0;
function startCountdown() {
  clearInterval(timer);
  const box = $('#countdown');
  if (!cfg?.event_start) return;
  const target = Date.parse(cfg.event_start);
  const tick = () => {
    const ms = target - Date.now();
    if (ms <= 0) { box.hidden = true; clearInterval(timer); return; }
    box.hidden = false;
    const s = Math.floor(ms / 1000);
    const set = (k: string, v: number) => (box.querySelector(`[data-cd="${k}"]`)!.textContent = String(v));
    set('d', Math.floor(s / 86400));
    set('h', Math.floor((s % 86400) / 3600));
    set('m', Math.floor((s % 3600) / 60));
    set('s', s % 60);
  };
  tick();
  timer = window.setInterval(tick, 1000);
}

const STATUS_LABEL: Record<string, [string, string]> = {
  verified: ['تذكرة جاهزة', 'Ticket ready'],
  review: ['قيد المراجعة', 'Under review'],
  rejected: ['لم يُقبل', 'Not accepted'],
};

function renderMine() {
  const list = savedTickets();
  const box = $('#mine');
  box.querySelectorAll('a').forEach((a) => a.remove());
  box.hidden = !list.length;
  for (const tk of list) {
    const a = document.createElement('a');
    a.href = `/t/${tk.code}`;
    const left = document.createElement('span');
    const n = document.createElement('span');
    n.textContent = tk.name;
    left.append(n);
    if (tk.status && STATUS_LABEL[tk.status]) {
      const pill = document.createElement('span');
      pill.className = `mine__status mine__status--${tk.status}`;
      pill.textContent = t(...STATUS_LABEL[tk.status]);
      left.append(pill);
    }
    const c = document.createElement('span');
    c.className = 'mono';
    c.textContent = tk.code.slice(0, 4) + '…';
    a.append(left, c);
    box.append(a);
  }
}

/** Refresh the saved tickets' status so the list shows whether each is approved yet. */
async function refreshMine() {
  const list = savedTickets().slice(0, 6);
  if (!list.length) return;
  await Promise.all(list.map(async (tk) => {
    const { ticket } = await getTicket(tk.code);
    if (ticket) rememberTicket(tk.code, tk.name, ticket.status);
  }));
  renderMine();
}

// ------------------------------------------------------------------- copy
document.addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]');
  if (!b) return;
  const text = document.querySelector(b.dataset.copy!)?.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    toast(t('تم النسخ', 'Copied'));
  } catch {}
});

function toast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

// ------------------------------------------------------------ seat picker
// Chosen seats are held on the server for 7 minutes under a token kept in this tab,
// so a reload keeps them. The hold is renewed each time the choice changes.
const HOLD_KEY = 'xi74-hold';
type Hold = { token: string; seats: string[]; expires: string };
let salesClosed = false;
let chosen: string[] = [];
let hold: Hold | null = null;
let syncing: Promise<void> | null = null;
let syncTimer = 0;
let seatsCache: { taken: string[]; held: string[]; blocked: string[]; locked: string[] } = { taken: [], held: [], blocked: [], locked: [] };

const readHold = (): Hold | null => {
  try {
    const h = JSON.parse(sessionStorage.getItem(HOLD_KEY) || 'null');
    return h && Date.parse(h.expires) > Date.now() ? h : null;
  } catch { return null; }
};
const writeHold = (h: Hold | null) => {
  hold = h;
  try { h ? sessionStorage.setItem(HOLD_KEY, JSON.stringify(h)) : sessionStorage.removeItem(HOLD_KEY); } catch {}
};

const map = mountSeatMap($('#seatmap'), pick);

function pickerMsg(text: string) {
  $('#picker-msg').textContent = text;
}

function pick(id: string) {
  if (salesClosed) return;
  pickerMsg('');
  if (chosen.includes(id)) chosen = chosen.filter((x) => x !== id);
  else if (chosen.length >= MAX_SEATS) { pickerMsg(t(`يمكنك اختيار ${MAX_SEATS} مقاعد كحد أقصى في الحجز الواحد.`, `You can choose up to ${MAX_SEATS} seats per booking.`)); return; }
  else chosen = [...chosen, id].sort();
  paintSeats();
  renderChosen();
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => { syncing = syncHold(); }, 450);
}

/** Tells the server which seats this guest is holding (or lets them go). */
async function syncHold(): Promise<void> {
  const want = [...chosen];
  try {
    if (!want.length) {
      if (hold) fetch(`${API}/fest-seats`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'release', token: hold.token }) }).catch(() => {});
      writeHold(null);
      renderTimer();
      return;
    }
    const r = await fetch(`${API}/fest-seats`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'hold', seats: want, token: hold?.token }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) {
      writeHold({ token: j.token, seats: j.seats, expires: j.expires_at });
    } else if (r.status === 409) {
      // Someone else got there first: drop those seats and show the fresh plan.
      const mine = new Set(hold?.seats ?? []);
      const lost = want.filter((id) => (j.taken ?? []).includes(id) || ((j.held ?? []).includes(id) && !mine.has(id)));
      seatsCache = { taken: j.taken ?? [], held: j.held ?? [], blocked: j.blocked ?? seatsCache.blocked, locked: j.locked ?? seatsCache.locked };
      chosen = chosen.filter((id) => !lost.includes(id));
      pickerMsg(t(`سبقك أحد إلى ${lost.length > 1 ? 'هذه المقاعد' : 'هذا المقعد'}: ${lost.map((x) => seatLabel(x, 'ar')).join('، ')}. اختر غيره.`, `Someone else just took ${lost.map((x) => seatLabel(x, 'en')).join(', ')}. Please choose another.`));
      paintSeats();
      renderChosen();
      if (chosen.length) return syncHold();
    } else if (j.error === 'too_many_holds') {
      pickerMsg(t('مقاعد كثيرة محجوزة مؤقتاً من هذا الجهاز. أكمل حجزاً أو انتظر قليلاً.', 'Too many seats are being held from this device. Finish a booking or wait a little.'));
    } else if (j.error === 'sales_closed') {
      pickerMsg(t('الحجز مغلق حالياً.', 'Booking is closed right now.'));
    }
  } catch {
    pickerMsg(t('تعذر الاتصال لحجز المقاعد. تأكد من الإنترنت.', 'Could not reach the server to hold your seats. Check your internet.'));
  } finally {
    renderTimer();
  }
}

function paintSeats() {
  const mine = new Set(hold?.seats ?? []);
  const taken = new Set(seatsCache.taken);
  const held = new Set(seatsCache.held);
  const blocked = new Set(seatsCache.blocked);
  const locked = new Set(seatsCache.locked);
  for (const id of map.ids()) {
    if (blocked.has(id) || isBlockedSeat(id)) map.set(id, 'blocked');
    else if (isVipSeat(id)) map.set(id, 'vip'); // VIP rows are on the plan, but the organisers give them out
    else if (locked.has(id)) map.set(id, 'locked'); // a phase that hasn't opened yet
    else if (chosen.includes(id)) map.set(id, 'selected');
    else if (taken.has(id)) map.set(id, 'taken');
    else if (held.has(id) && !mine.has(id)) map.set(id, 'held');
    else map.set(id, 'free');
  }
}

async function refreshSeats() {
  try {
    const r = await fetch(`${API}/fest-seats`);
    if (!r.ok) return;
    const j = await r.json();
    seatsCache = { taken: j.taken ?? [], held: j.held ?? [], blocked: j.blocked ?? [], locked: j.locked ?? [] };
    if (j.phase) map.setPhase(j.phase);
    chosen = chosen.filter((id) => !isVipSeat(id) && !isBlockedSeat(id) && !seatsCache.blocked.includes(id) && !seatsCache.locked.includes(id));
    // A chosen seat that was bought meanwhile (only possible once a hold ran out).
    const lost = chosen.filter((id) => seatsCache.taken.includes(id));
    if (lost.length) {
      chosen = chosen.filter((id) => !lost.includes(id));
      pickerMsg(t(`لم يعد متاحاً: ${lost.map((x) => seatLabel(x, 'ar')).join('، ')}.`, `No longer available: ${lost.map((x) => seatLabel(x, 'en')).join(', ')}.`));
      renderChosen();
      syncing = syncHold();
    }
    paintSeats();
  } catch {}
}

let tick = 0;
function renderTimer() {
  clearInterval(tick);
  const box = $('#picker-timer');
  box.hidden = !hold;
  if (!hold) return;
  const end = Date.parse(hold.expires);
  const draw = () => {
    const ms = end - Date.now();
    if (ms <= 0) {
      clearInterval(tick);
      writeHold(null);
      chosen = [];
      box.hidden = true;
      pickerMsg(t('انتهت مهلة الـ7 دقائق وأُتيحت المقاعد لغيرك. اختر مقاعدك مرة أخرى.', 'The 7 minutes ran out and the seats were released. Please choose again.'));
      renderChosen();
      refreshSeats();
      return;
    }
    const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000);
    box.querySelector('span')!.textContent = t(`محجوزة لك ${m}:${String(sec).padStart(2, '0')}`, `Held for you ${m}:${String(sec).padStart(2, '0')}`);
  };
  draw();
  tick = window.setInterval(draw, 1000);
}

function renderChosen() {
  const price = cfg?.price ?? 100;
  const n = chosen.length;
  const total = n * price;
  const l = lang();
  $('#picker-seats').textContent = n ? `${t(`${n} ${n === 1 ? 'مقعد' : n === 2 ? 'مقعدان' : n <= 10 ? 'مقاعد' : 'مقعداً'}`, `${n} seat${n === 1 ? '' : 's'}`)}: ${seatsSummary(chosen, l)}` : t('لم تختر مقاعد بعد.', 'No seats chosen yet.');
  $('#picker-total').textContent = String(total);
  $('#picker-clear').hidden = !n;
  $('#pay-total').textContent = String(n ? total : price);
  $('#pay-calc').textContent = n ? t(`${n} × ${price} جنيه`, `${n} × ${price} EGP`) : t('للمقعد الواحد', 'per seat');
  const box = $('#chosen');
  box.classList.toggle('chosen--empty', !n);
  $('#chosen-empty').hidden = !!n;
  $('#chosen-top').hidden = $('#chosen-list').hidden = !n;
  $('#chosen-count').textContent = t(`${n} ${n === 1 ? 'مقعد' : n === 2 ? 'مقعدان' : 'مقاعد'} · ${n} × ${price}`, `${n} seat${n === 1 ? '' : 's'} · ${n} × ${price}`);
  $('#chosen-total').textContent = String(total);
  $('#chosen-list').replaceChildren(...chosen.map((id) => Object.assign(document.createElement('span'), { textContent: seatLabel(id, l) })));
  if (n) setErr('seats', '');
}

$('#picker-clear').addEventListener('click', () => {
  chosen = [];
  pickerMsg('');
  paintSeats();
  renderChosen();
  syncing = syncHold();
});

// Restore a hold from earlier in this tab (e.g. after coming back from the InstaPay app).
hold = readHold();
if (hold) chosen = [...hold.seats];
refreshSeats().then(renderTimer);
setInterval(() => { if (document.visibilityState === 'visible') refreshSeats(); }, 15_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { hold = readHold(); if (!hold && chosen.length) { chosen = []; renderChosen(); } refreshSeats(); renderTimer(); } });

// ---------------------------------------------------------------- the form
const form = $<HTMLFormElement>('#buy-form');
const fileInput = $<HTMLInputElement>('#f-receipt');
const drop = $('#drop');
let file: File | null = null;

function showFile(f: File | null) {
  file = f;
  const thumb = $<HTMLImageElement>('#drop-thumb');
  drop.classList.toggle('has-file', !!f);
  (drop.querySelector('.drop__empty') as HTMLElement).hidden = !!f;
  thumb.hidden = $('#drop-name').hidden = $('#drop-swap').hidden = !f;
  if (f) {
    if (thumb.src) URL.revokeObjectURL(thumb.src);
    thumb.src = URL.createObjectURL(f);
    $('#drop-name').textContent = f.name;
    setErr('receipt', '');
  }
}
fileInput.addEventListener('change', () => showFile(fileInput.files?.[0] ?? null));
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) showFile(f);
});

function setErr(field: string, msg: string) {
  const el = form.querySelector<HTMLElement>(`[data-err="${field}"]`);
  if (el) el.textContent = msg;
  const input = form.querySelector<HTMLElement>(`[name="${field}"]`);
  if (input && field !== 'receipt') input.setAttribute('aria-invalid', msg ? 'true' : 'false');
}

const normPhone = (s: string) => s.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '');

function validate() {
  let ok = true;
  const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
  const phone = normPhone((form.elements.namedItem('phone') as HTMLInputElement).value);
  const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim();
  setErr('name', ''); setErr('phone', ''); setErr('email', ''); setErr('receipt', ''); setErr('seats', '');
  if (!chosen.length) { setErr('seats', t('اختر مقعداً واحداً على الأقل من خريطة المسرح.', 'Choose at least one seat on the theatre plan.')); ok = false; }
  if (name.length < 3 || !/\s/.test(name)) { setErr('name', t('اكتب اسمك الثنائي على الأقل.', 'Please write at least your first and last name.')); ok = false; }
  if (!/^(01\d{9}|201\d{9}|\d{8,15})$/.test(phone)) { setErr('phone', t('اكتب رقم موبايل صحيح، مثل 01012345678.', 'Enter a valid mobile number, e.g. 01012345678.')); ok = false; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('email', t('البريد الإلكتروني غير صحيح.', 'That email address looks wrong.')); ok = false; }
  if (!file) { setErr('receipt', t('ارفع صورة إيصال التحويل.', 'Please add the transfer screenshot.')); ok = false; }
  else if (!/^image\/(png|jpe?g|webp)$/.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) { setErr('receipt', t('ارفع صورة بصيغة PNG أو JPG.', 'Please upload a PNG or JPG image.')); ok = false; }
  if (!ok) form.querySelector<HTMLElement>('[aria-invalid="true"], .err:not(:empty)')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return ok;
}

/** Large photos are scaled down (longest side 2400px) so the receipt stays readable but uploads fast. */
async function prepare(f: File): Promise<Blob> {
  if (f.size <= 3_400_000 || !('createImageBitmap' in window)) return f;
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
    return out && out.size < f.size ? out : f;
  } catch {
    return f;
  }
}

const ERRORS: Record<string, [string, string]> = {
  bad_name: ['اكتب اسمك بالكامل.', 'Please write your full name.'],
  bad_phone: ['رقم الموبايل غير صحيح.', 'The mobile number is not valid.'],
  bad_email: ['البريد الإلكتروني غير صحيح.', 'The email address is not valid.'],
  receipt_required: ['ارفع صورة إيصال التحويل.', 'Please add the transfer screenshot.'],
  too_big: ['الصورة كبيرة جداً. ارفع لقطة شاشة عادية.', 'The image is too large. Upload a normal screenshot.'],
  bad_file: ['الملف ليس صورة PNG أو JPG.', 'The file is not a PNG or JPG image.'],
  sales_closed: ['الحجز مغلق حالياً.', 'Booking is closed right now.'],
  sold_out: ['نفدت التذاكر.', 'Tickets are sold out.'],
  busy: ['ضغط كبير الآن. حاول بعد دقيقة.', 'We are busy right now. Try again in a minute.'],
  too_many: ['محاولات كثيرة من هذا الجهاز. حاول بعد قليل.', 'Too many attempts from this device. Try again shortly.'],
  duplicate_receipt: ['هذا الإيصال مستخدم لتذكرة أخرى برقم موبايل مختلف.', 'This receipt was already used for a ticket with another number.'],
  reference_used: ['هذا التحويل مستخدم لتذكرة أخرى.', 'This transfer was already used for another ticket.'],
  save_failed: ['حدث خطأ أثناء الحفظ. حاول مرة أخرى.', 'Something went wrong saving it. Please try again.'],
  network: ['تعذر الاتصال. تأكد من الإنترنت وحاول مرة أخرى.', 'Could not connect. Check your internet and try again.'],
  seats_required: ['اختر مقاعدك من خريطة المسرح أولاً.', 'Choose your seats on the theatre plan first.'],
  bad_request: ['تعذر إرسال الطلب من هذا المتصفح. افتح الرابط في Chrome أو Safari وحاول مرة أخرى.', 'This browser could not send the form. Open the link in Chrome or Safari and try again.'],
  seat_unavailable: ['أحد المقاعد التي اخترتها لم يعد متاحاً. راجع اختيارك على الخريطة وأعد الإرسال.', 'One of your seats is no longer available. Check your choice on the plan and send again.'],
};

function formError(code: string | null) {
  const box = $('#form-error');
  box.hidden = !code;
  if (code) {
    const [ar, en] = ERRORS[code] ?? ERRORS.save_failed;
    box.querySelector('span')!.textContent = t(ar, en);
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

let stageTimer = 0;
function checking(on: boolean) {
  const ov = $('#checking');
  ov.hidden = !on;
  document.body.style.overflow = on ? 'hidden' : '';
  clearInterval(stageTimer);
  const items = [...ov.querySelectorAll<HTMLElement>('li')];
  items.forEach((li) => li.classList.remove('on', 'done'));
  if (!on) return;
  let i = 0;
  items[0].classList.add('on');
  stageTimer = window.setInterval(() => {
    if (i >= items.length - 1) return;
    items[i].classList.replace('on', 'done');
    items[++i].classList.add('on');
  }, 4500);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(null);
  if (!validate()) return;
  const btn = $<HTMLButtonElement>('#buy-submit');
  btn.disabled = true;
  checking(true);
  try {
    const fd = new FormData(form);
    fd.set('phone', normPhone(String(fd.get('phone'))));
    fd.set('lang', lang());
    // Make sure the server holds exactly these seats for us before paying for them.
    clearTimeout(syncTimer);
    if (syncing) await syncing;
    if (!hold || hold.seats.join() !== chosen.join() || Date.parse(hold.expires) - Date.now() < 30_000) await syncHold();
    if (!chosen.length) throw new Error('seats_required');
    fd.set('seats', chosen.join(','));
    fd.delete('website'); // in-app browsers autofill the hidden anti-spam field
    if (hold) fd.set('hold', hold.token);
    const blob = await prepare(file!);
    fd.set('receipt', blob, blob === file ? file!.name : 'receipt.jpg');
    const r = await fetch(`${API}/fest-buy`, { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({ error: 'save_failed' }));
    if (!r.ok || !j.code) {
      if (j.error === 'seat_unavailable') refreshSeats();
      throw new Error(j.error || 'save_failed');
    }
    rememberTicket(j.code, String(fd.get('name')), j.status);
    writeHold(null); // the seats now belong to the booking
    location.href = `/t/${j.code}?new=1`;
  } catch (err) {
    checking(false);
    btn.disabled = false;
    const code = err instanceof TypeError ? 'network' : (err as Error).message;
    formError(code);
  }
});

// Keep option labels in the active language.
function syncOptions() {
  document.querySelectorAll<HTMLOptionElement>('option[data-ar]').forEach((o) => (o.textContent = lang() === 'en' ? o.dataset.en! : o.dataset.ar!));
}
document.addEventListener('langchange', () => { syncOptions(); renderConfig(); renderMine(); renderChosen(); renderTimer(); if (!$('#form-error').hidden) formError(null); });
syncOptions();
renderMine();
refreshMine();

// The sponsors link works even before the config arrives.
$<HTMLAnchorElement>('#sponsors-link').href ||= SPONSORS_URL;
getConfig().then((c) => {
  cfg = c;
  if (c) renderConfig();
});

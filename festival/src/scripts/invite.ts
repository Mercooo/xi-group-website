// Invitation page: live event details, the InstaPay box and the booking form.
import { API, SPONSORS_URL } from '../lib/site';
import { getConfig, getTicket, rememberTicket, savedTickets, type PublicConfig } from './api';
import { formatDate, formatTime, lang, t } from './lang';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
let cfg: PublicConfig | null = null;

// ------------------------------------------------------------- event details
function renderConfig() {
  if (!cfg) return;
  document.querySelectorAll('[data-price]').forEach((el) => (el.textContent = String(cfg!.price)));

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
  setErr('name', ''); setErr('phone', ''); setErr('email', ''); setErr('receipt', '');
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
    const blob = await prepare(file!);
    fd.set('receipt', blob, blob === file ? file!.name : 'receipt.jpg');
    const r = await fetch(`${API}/fest-buy`, { method: 'POST', body: fd });
    const j = await r.json().catch(() => ({ error: 'save_failed' }));
    if (!r.ok || !j.code) throw new Error(j.error || 'save_failed');
    rememberTicket(j.code, String(fd.get('name')), j.status);
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
document.addEventListener('langchange', () => { syncOptions(); renderConfig(); renderMine(); if (!$('#form-error').hidden) formError(null); });
syncOptions();
renderMine();
refreshMine();

// The sponsors link works even before the config arrives.
$<HTMLAnchorElement>('#sponsors-link').href ||= SPONSORS_URL;
getConfig().then((c) => {
  cfg = c;
  if (c) renderConfig();
});

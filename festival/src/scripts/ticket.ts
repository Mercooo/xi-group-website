// Ticket page: /t/CODE. Shows the QR once the payment is verified, and keeps
// checking while the receipt is in review.
import QRCode from 'qrcode';
import { SPONSORS_URL } from '../lib/site';
import { reasonText } from '../lib/reasons';
import { getTicket, rememberTicket, type SeatTicket, type Ticket } from './api';
import { formatDate, formatDateTime, formatTime, lang, t } from './lang';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const code = (location.pathname.match(/\/t\/([A-Za-z0-9]{8,16})/)?.[1] || new URLSearchParams(location.search).get('c') || '').toUpperCase();
const ticketUrl = `${location.origin}/t/${code}`;
let current: Ticket | null = null;
let poll = 0;
// Which seat's ticket is on screen (a QR opened from …?seat=CODE starts on that seat).
let seatCode = (new URLSearchParams(location.search).get('seat') || '').toUpperCase();
const seatsOf = (tk: Ticket) => (tk.seats ?? []).filter((s) => s.code);
const seatUrl = (s: SeatTicket | null) => (s?.code ? `${ticketUrl}?seat=${s.code}` : ticketUrl);
const seatName = (s: SeatTicket) => (lang() === 'en' ? s.label_en : s.label_ar);
// Opened right after booking (/t/CODE?new=1): say the booking was received.
const fresh = new URLSearchParams(location.search).has('new');
if (fresh) {
  const u = new URL(location.href);
  u.searchParams.delete('new');
  history.replaceState(null, '', u.pathname + u.search);
}
// Reasons that only mean "no automatic check ran"; the guest doesn't need to see them.
const GENERIC = new Set(['auto_check_unavailable', 'auto_check_failed', 'auto_check_declined', 'image_too_large_for_auto_check', 'recipient_not_configured', 'unknown_receipt_type']);
const baseTitle = document.title;

function view(name: string) {
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((v) => (v.hidden = v.dataset.view !== name));
  $('#tk-actions').hidden = name !== 'verified';
  $('#offers').hidden = name !== 'verified';
}

function fill(field: string, value: string) {
  document.querySelectorAll<HTMLElement>(`[data-f="${field}"]`).forEach((el) => (el.textContent = value));
}

function whenText(tk: Ticket) {
  return tk.event_start ? `${formatDate(tk.event_start)} · ${formatTime(tk.event_start)}` : null;
}

async function render(tk: Ticket) {
  current = tk;
  fill('code', tk.code.replace(/(.{4})/g, '$1 ').trim());
  fill('name', tk.name);
  fill('holder', `${tk.name} · \u2066${tk.phone}\u2069`);
  const when = whenText(tk);
  if (when) fill('when', when);
  if (tk.venue_name) {
    const el = document.querySelector<HTMLElement>('[data-f="where"]')!;
    el.textContent = '';
    const name = tk.maps_url ? Object.assign(document.createElement('a'), { href: tk.maps_url, target: '_blank', rel: 'noopener', textContent: tk.venue_name }) : document.createTextNode(tk.venue_name);
    el.append(name);
    if (tk.venue_detail) {
      const d = document.createElement('small');
      d.textContent = tk.venue_detail;
      el.append(d);
    }
  }
  fillReasons(tk.reasons);

  const prevStatus = lastStatus;
  lastStatus = tk.status;
  clearTimeout(poll);
  if (tk.status === 'verified') {
    view('verified');
    rememberTicket(tk.code, tk.name, 'verified');
    document.title = baseTitle;
    const justApproved = prevStatus === 'review';
    (document.querySelector('[data-f="approved"]') as HTMLElement).hidden = !justApproved;
    if (justApproved) announce(t('تم قبول حجزك! تذكرتك جاهزة.', 'Your booking was approved! Your ticket is ready.'));
    await showSeat(tk);
    $<HTMLAnchorElement>('#offers').href = tk.sponsors_url || SPONSORS_URL;
    setupCalendar(tk);
    const allIn = seatsOf(tk).length ? seatsOf(tk).every((x) => x.checked_in_at) : !!tk.checked_in_at;
    if (!allIn) poll = window.setTimeout(load, 60_000); // reflect the gate check-in
  } else if (tk.status === 'review') {
    view('review');
    rememberTicket(tk.code, tk.name, 'review');
    document.title = t('قيد المراجعة · ', 'Under review · ') + baseTitle;
    (document.querySelector('[data-f="fresh"]') as HTMLElement).hidden = !fresh;
    const seatList = (tk.seats ?? []).map(seatName);
    (document.querySelector('[data-f="seats-wrap"]') as HTMLElement).hidden = !seatList.length;
    fill('seats', seatList.join(t('، ', ', ')));
    const specific = tk.reasons.filter((r) => !GENERIC.has(r));
    (document.querySelector('[data-f="why"]') as HTMLElement).hidden = !specific.length;
    fillReasons(specific);
    fill('checked', t(`آخر تحديث ${formatTime(new Date().toISOString())} · تتحدث هذه الصفحة تلقائياً`, `Last checked ${formatTime(new Date().toISOString())} · this page updates by itself`));
    setupContact(tk);
    setupNotify();
    poll = window.setTimeout(load, 20_000);
  } else {
    view('rejected');
    rememberTicket(tk.code, tk.name, 'rejected');
    document.title = baseTitle;
    if (prevStatus === 'review') announce(t('للأسف لم يُقبل الإيصال. افتح الصفحة لمعرفة السبب.', 'Sorry, the receipt was not accepted. Open the page to see why.'));
  }
}

/** Shows one seat's QR (or the booking's QR for bookings made before seats existed). */
async function showSeat(tk: Ticket) {
  const seats = seatsOf(tk);
  let cur: SeatTicket | null = null;
  if (seats.length) {
    cur = seats.find((x) => x.code === seatCode) ?? seats.find((x) => !x.checked_in_at) ?? seats[0];
    seatCode = cur.code!;
  }
  const tabs = $('#seat-tabs');
  tabs.hidden = seats.length < 2;
  tabs.replaceChildren(...seats.map((x) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(x === cur));
    b.classList.toggle('is-used', !!x.checked_in_at);
    b.textContent = seatName(x);
    b.addEventListener('click', () => { seatCode = x.code!; showSeat(tk); });
    return b;
  }));
  $('#tk-seat').hidden = !cur;
  $('#tk-seat').textContent = cur ? seatName(cur) : '';
  $('#tk-howto').hidden = seats.length > 1;
  $('#tk-howto-seats').hidden = seats.length <= 1;
  $('#pdf-label').textContent = seats.length > 1 ? t(`تحميل التذاكر الـ${seats.length} PDF للطباعة`, `Download all ${seats.length} tickets as PDF`) : t('تحميل التذكرة PDF للطباعة', 'Download printable PDF');
  await QRCode.toCanvas($<HTMLCanvasElement>('#qr'), seatUrl(cur), { width: 520, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0d1611', light: '#ffffff' } });
  const usedAt = cur ? cur.checked_in_at : tk.checked_in_at;
  $('#qr-frame').classList.toggle('is-used', !!usedAt);
  $('#used-stamp').hidden = !usedAt;
  const chip = $('#tk-chip');
  chip.className = `chip ${usedAt ? 'chip--bad' : 'chip--ok'}`;
  chip.textContent = usedAt ? t(`تم الدخول ${formatDateTime(usedAt)}`, `Checked in ${formatDateTime(usedAt)}`) : t('صالحة للدخول', 'Valid for entry');
}

let lastStatus: Ticket['status'] | null = null;

function fillReasons(codes: string[]) {
  document.querySelectorAll<HTMLElement>('[data-f="reasons"]').forEach((ul) => {
    ul.textContent = '';
    const uniq = [...new Set(codes.map((r) => reasonText(r, lang())))];
    for (const r of uniq) {
      const li = document.createElement('li');
      li.textContent = r;
      ul.append(li);
    }
    ul.hidden = !uniq.length;
  });
}

function setupContact(tk: Ticket) {
  const a = document.querySelector<HTMLAnchorElement>('[data-contact]');
  if (!a) return;
  const msg = t(`مرحباً، حجزي لعيد الـ74 ما زال قيد المراجعة. رمز الحجز: ${tk.code}`, `Hello, my booking for the 74th anniversary is still under review. Booking code: ${tk.code}`);
  a.href = tk.contact_whatsapp ? `https://wa.me/${tk.contact_whatsapp}?text=${encodeURIComponent(msg)}` : 'https://m.me/XI.SGWEN';
}

/** "Alert me when approved": a browser notification while this page stays open (even in a background tab). */
function setupNotify() {
  const b = document.querySelector<HTMLButtonElement>('[data-notify]');
  if (!b || !('Notification' in window) || Notification.permission === 'denied') return;
  b.hidden = false;
  if (Notification.permission === 'granted') {
    b.disabled = true;
    b.querySelectorAll('span').forEach((x) => x.remove());
    const label = document.createElement('span');
    label.textContent = t('سننبهك هنا فور القبول', 'We’ll alert you here once approved');
    b.append(label);
  }
}
document.querySelector('[data-notify]')?.addEventListener('click', async () => {
  try { await Notification.requestPermission(); } catch {}
  setupNotify();
});

function announce(text: string) {
  toast(text);
  try { navigator.vibrate?.([120, 60, 120]); } catch {}
  try {
    if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      new Notification(t('عيد الـ74 · المجموعة الحادية عشر', 'XI Group · 74th anniversary'), { body: text, icon: '/img/xi-logo.webp', tag: code });
    }
  } catch {}
}

async function load() {
  if (!code) return view('missing');
  const { ticket, error } = await getTicket(code);
  if (ticket) return render(ticket);
  view(error === 'not_found' || error === 'bad_code' ? 'missing' : 'offline');
}

function setupCalendar(tk: Ticket) {
  const a = $<HTMLAnchorElement>('#cal');
  if (!tk.event_start) { a.hidden = true; return; }
  const fmt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = tk.event_end || new Date(Date.parse(tk.event_start) + 4 * 3600_000).toISOString();
  const esc = (s: string) => s.replace(/[\\,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//XI Group//74//AR', 'BEGIN:VEVENT',
    `UID:${tk.code}@xi-74`, `DTSTAMP:${fmt(new Date().toISOString())}`,
    `DTSTART:${fmt(tk.event_start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:${esc('عيد الـ74 للمجموعة الحادية عشر')}`,
    tk.venue_name ? `LOCATION:${esc([tk.venue_name, tk.venue_detail].filter(Boolean).join('، '))}` : '',
    `DESCRIPTION:${esc(`تذكرتك: ${ticketUrl}`)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  if (a.href.startsWith('blob:')) URL.revokeObjectURL(a.href);
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.hidden = false;
}

// The festival's own ticket artwork (1925 × 817). The main part is printed as designed;
// the stub on the right becomes the admission part: the seat's QR, its seat and the holder.
const ART = '/img/journey/ticket-art.jpg';
const ART_W = 1925, ART_H = 817;
let artImg: Promise<HTMLImageElement> | null = null;
const loadArt = () => (artImg ??= new Promise((resolve, reject) => {
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = () => { artImg = null; reject(new Error('art')); };
  im.src = ART;
}));

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
}

/** The printable ticket for one seat (or the whole booking when it has no seats). */
async function drawTicket(tk: Ticket, seat: SeatTicket | null): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  const art = await loadArt();
  const c = document.createElement('canvas');
  c.width = ART_W; c.height = ART_H;
  const g = c.getContext('2d')!;
  g.drawImage(art, 0, 0, ART_W, ART_H);
  const ar = lang() === 'ar';
  const cx = 1732; // centre of the stub

  // Admission panel over the stub's small medallion.
  const px = 1562, py = 186, pw = 340, ph = 338;
  const panel = g.createLinearGradient(0, py, 0, py + ph);
  panel.addColorStop(0, '#13246a'); panel.addColorStop(1, '#0a1442');
  g.save();
  g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 18; g.shadowOffsetY = 6;
  roundRect(g, px, py, pw, ph, 26); g.fillStyle = panel; g.fill();
  g.restore();
  const gold = g.createLinearGradient(px, py, px + pw, py + ph);
  gold.addColorStop(0, '#fff1c2'); gold.addColorStop(0.45, '#e8c068'); gold.addColorStop(0.75, '#a8792a'); gold.addColorStop(1, '#f2d27e');
  roundRect(g, px, py, pw, ph, 26); g.lineWidth = 5; g.strokeStyle = gold; g.stroke();
  roundRect(g, px + 9, py + 9, pw - 18, ph - 18, 19); g.lineWidth = 1.5; g.strokeStyle = 'rgba(232,192,104,.55)'; g.stroke();

  // The QR the gate scans.
  const qs = 232;
  const q = document.createElement('canvas');
  await QRCode.toCanvas(q, seatUrl(seat), { width: qs, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0a1338', light: '#ffffff' } });
  roundRect(g, cx - qs / 2 - 10, py + 20, qs + 20, qs + 20, 14); g.fillStyle = '#ffffff'; g.fill();
  g.drawImage(q, cx - qs / 2, py + 30, qs, qs);

  // The seat, in gold, under the QR.
  g.textAlign = 'center';
  g.direction = ar ? 'rtl' : 'ltr';
  g.fillStyle = gold;
  g.font = '800 34px "Cairo Variable", Cairo, sans-serif';
  g.fillText(seat ? seatName(seat) : t('دخول شخص واحد', 'Admit one'), cx, py + ph - 22, pw - 30);

  // Holder and code where the barcode was.
  const bx = 1587, by = 597, bw = 290, bh = 96;
  roundRect(g, bx, by, bw, bh, 10); g.fillStyle = '#fffaf0'; g.fill();
  g.lineWidth = 2; g.strokeStyle = gold; g.stroke();
  g.fillStyle = '#0a1338';
  g.font = '700 28px "Cairo Variable", Cairo, sans-serif';
  g.fillText(tk.name, cx, by + 40, bw - 24);
  g.direction = 'ltr';
  g.fillStyle = '#5d4a1f';
  g.font = '600 22px ui-monospace, Menlo, Consolas, monospace';
  g.fillText((seat?.code ?? tk.code).replace(/(.{4})(?=.)/g, '$1 '), cx, by + 76);
  return c;
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/** A picture of the ticket on screen, for people who'd rather show a photo at the gate. */
async function saveImage() {
  if (!current) return;
  const seat = seatsOf(current).find((x) => x.code === seatCode) ?? null;
  const c = await drawTicket(current, seat);
  c.toBlob((b) => b && download(b, `xi-74-${seat ? seat.id : current!.code}.png`), 'image/png');
}

/** Every seat's ticket as one A5 page each, ready to print. */
async function savePdf() {
  if (!current) return;
  const btn = $<HTMLButtonElement>('#save-pdf');
  btn.disabled = true;
  try {
    const { jsPDF } = await import('jspdf');
    const seats = seatsOf(current);
    const pages = seats.length ? seats : [null];
    const pageW = 210, pageH = Math.round((210 * ART_H / ART_W) * 10) / 10; // ticket-sized, 210 × 89 mm
    const pdf = new jsPDF({ unit: 'mm', format: [pageW, pageH], orientation: 'landscape', compress: true });
    for (let i = 0; i < pages.length; i++) {
      if (i) pdf.addPage([pageW, pageH], 'landscape');
      const c = await drawTicket(current, pages[i]);
      pdf.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, pageW, pageH);
    }
    pdf.setProperties({ title: t('تذاكر عيد الـ74', '74th anniversary tickets'), creator: 'XI Group' });
    download(pdf.output('blob'), `xi-74-${current.code}.pdf`);
  } catch (e) {
    console.error(e);
    toast(t('تعذر إنشاء الملف. جرّب حفظ الصورة.', 'Could not make the PDF. Try saving the image.'));
  } finally {
    btn.disabled = false;
  }
}

function toast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

async function copyLink() {
  try { await navigator.clipboard.writeText(ticketUrl); toast(t('تم نسخ الرابط', 'Link copied')); } catch {}
}

$('#save-qr').addEventListener('click', saveImage);
$('#save-pdf').addEventListener('click', savePdf);
$('#share').addEventListener('click', async () => {
  if (navigator.share) {
    try { await navigator.share({ title: t('تذكرتي لعيد الـ74', 'My 74th anniversary ticket'), url: ticketUrl }); } catch {}
  } else copyLink();
});
document.querySelector('[data-copy-link]')?.addEventListener('click', copyLink);
document.querySelector('[data-retry]')?.addEventListener('click', () => { view('loading'); load(); });
document.addEventListener('langchange', () => current && render(current));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && current && current.status !== 'rejected') { clearTimeout(poll); load(); } });
load();

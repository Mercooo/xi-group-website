// Ticket page: /t/CODE. Shows the QR once the payment is verified, and keeps
// checking while the receipt is in review.
import QRCode from 'qrcode';
import { SPONSORS_URL } from '../lib/site';
import { reasonText } from '../lib/reasons';
import { getTicket, rememberTicket, type Ticket } from './api';
import { formatDate, formatDateTime, formatTime, lang, t } from './lang';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const code = (location.pathname.match(/\/t\/([A-Za-z0-9]{8,16})/)?.[1] || new URLSearchParams(location.search).get('c') || '').toUpperCase();
const ticketUrl = `${location.origin}/t/${code}`;
let current: Ticket | null = null;
let poll = 0;

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
  document.querySelectorAll<HTMLElement>('[data-f="reasons"]').forEach((ul) => {
    ul.textContent = '';
    const uniq = [...new Set(tk.reasons.map((r) => reasonText(r, lang())))];
    for (const r of uniq) {
      const li = document.createElement('li');
      li.textContent = r;
      ul.append(li);
    }
    ul.hidden = !uniq.length;
  });

  clearTimeout(poll);
  if (tk.status === 'verified') {
    view('verified');
    rememberTicket(tk.code, tk.name);
    await QRCode.toCanvas($<HTMLCanvasElement>('#qr'), ticketUrl, { width: 520, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0d1611', light: '#ffffff' } });
    const used = !!tk.checked_in_at;
    $('#qr-frame').classList.toggle('is-used', used);
    $('#used-stamp').hidden = !used;
    const chip = $('#tk-chip');
    chip.className = `chip ${used ? 'chip--bad' : 'chip--ok'}`;
    chip.textContent = used ? t(`تم الدخول ${formatDateTime(tk.checked_in_at!)}`, `Checked in ${formatDateTime(tk.checked_in_at!)}`) : t('صالحة للدخول', 'Valid for entry');
    $<HTMLAnchorElement>('#offers').href = tk.sponsors_url || SPONSORS_URL;
    setupCalendar(tk);
    if (!used) poll = window.setTimeout(load, 60_000); // reflect the gate check-in
  } else if (tk.status === 'review') {
    view('review');
    rememberTicket(tk.code, tk.name);
    poll = window.setTimeout(load, 20_000);
  } else {
    view('rejected');
  }
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

/** A shareable image of the ticket, for people who'd rather show a photo at the gate. */
async function saveImage() {
  if (!current) return;
  await document.fonts.ready;
  const W = 1080, H = 1560;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const ar = lang() === 'ar';
  g.direction = ar ? 'rtl' : 'ltr';
  // card
  g.fillStyle = '#0d1611'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f5f2ea';
  g.beginPath(); g.roundRect(60, 60, W - 120, H - 120, 44); g.fill();
  g.fillStyle = '#15231b';
  g.beginPath(); g.roundRect(60, 60, W - 120, 300, [44, 44, 0, 0]); g.fill();
  const colors = ['#f47b20', '#f2c230', '#4fae3a', '#c8322f'];
  colors.forEach((col, i) => { g.fillStyle = col; g.fillRect(60 + i * ((W - 120) / 4), 350, (W - 120) / 4, 12); });
  g.fillStyle = '#c9a961'; g.font = '700 190px "Reem Kufi"'; g.textAlign = 'left'; g.direction = 'ltr';
  g.fillText('74', 110, 300);
  g.direction = ar ? 'rtl' : 'ltr';
  g.textAlign = 'right';
  g.fillStyle = '#e8d7a8'; g.font = '600 38px "IBM Plex Sans Arabic"';
  g.fillText(t('المجموعة الحادية عشر', 'XI Group'), W - 110, 170);
  g.fillStyle = '#ffffff'; g.font = '700 54px "Reem Kufi"';
  g.fillText(t('تذكرة عيد الـ74', '74th anniversary'), W - 110, 250);
  // QR
  const q = document.createElement('canvas');
  await QRCode.toCanvas(q, ticketUrl, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0d1611', light: '#ffffff' } });
  g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect((W - 700) / 2, 420, 700, 700, 32); g.fill();
  g.drawImage(q, (W - 640) / 2, 450, 640, 640);
  g.textAlign = 'center';
  g.fillStyle = '#16241d'; g.font = '700 58px "Reem Kufi"';
  g.fillText(current.name, W / 2, 1210, W - 200);
  g.fillStyle = '#5d685f'; g.font = '600 40px ui-monospace, Menlo, monospace'; g.direction = 'ltr';
  g.fillText(current.code.replace(/(.{4})/g, '$1 ').trim(), W / 2, 1275);
  g.direction = ar ? 'rtl' : 'ltr';
  g.font = '400 36px "IBM Plex Sans Arabic"'; g.fillStyle = '#16241d';
  const when = whenText(current);
  if (when) g.fillText(when, W / 2, 1360, W - 200);
  if (current.venue_name) g.fillText(current.venue_name, W / 2, 1415, W - 200);
  g.fillStyle = '#75602c'; g.font = '400 30px "IBM Plex Sans Arabic"';
  g.fillText(t('تُستخدم مرة واحدة على البوابة', 'Valid for one entry'), W / 2, 1475);
  c.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `xi-74-${current!.code}.png`;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }, 'image/png');
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
$('#share').addEventListener('click', async () => {
  if (navigator.share) {
    try { await navigator.share({ title: t('تذكرتي لعيد الـ74', 'My 74th anniversary ticket'), url: ticketUrl }); } catch {}
  } else copyLink();
});
document.querySelector('[data-copy-link]')?.addEventListener('click', copyLink);
document.querySelector('[data-retry]')?.addEventListener('click', () => { view('loading'); load(); });
document.addEventListener('langchange', () => current && render(current));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && current && current.status !== 'rejected') load(); });
load();

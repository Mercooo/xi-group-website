// Gate scanner: the phone camera reads ticket QR codes and the backend admits
// each verified ticket exactly once (atomic check-in in the database).
import jsQR from 'jsqr';
import { staff } from './api';
import { formatDateTime } from './lang';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const S_KEY = 'xi74-gate-key';
const S_NAME = 'xi74-gate-name';
let key = sessionStorage.getItem(S_KEY) || '';
let gateName = localStorage.getItem(S_NAME) || '';

// ----------------------------------------------------------------- login
const LOGIN_ERR: Record<string, string> = {
  unauthorized: 'كلمة السر غير صحيحة.',
  locked: 'محاولات خاطئة كثيرة. انتظر عشر دقائق ثم حاول مرة أخرى.',
  not_configured: 'لم تُضبط كلمة سر البوابة بعد على الخادم.',
  network: 'تعذر الاتصال بالإنترنت.',
};

$<HTMLInputElement>('#g-name').value = gateName;
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const k = $<HTMLInputElement>('#g-key').value.trim();
  const n = $<HTMLInputElement>('#g-name').value.trim() || 'البوابة';
  const err = $('#login-err');
  err.hidden = true;
  const r = await staff('fest-gate', k, { action: 'login' });
  if (!r.ok) {
    err.querySelector('span')!.textContent = LOGIN_ERR[r.data.error || ''] || 'حدث خطأ، حاول مرة أخرى.';
    err.hidden = false;
    return;
  }
  key = k;
  gateName = n;
  sessionStorage.setItem(S_KEY, k);
  localStorage.setItem(S_NAME, n);
  start();
});

$('#logout').addEventListener('click', () => {
  sessionStorage.removeItem(S_KEY);
  key = '';
  stopCamera();
  $('#gate').hidden = true;
  $('#login').hidden = false;
});

// ---------------------------------------------------------------- camera
const video = $<HTMLVideoElement>('#video');
let stream: MediaStream | null = null;
let facing: 'environment' | 'user' = 'environment';
let detector: any = null;
let running = false;
let busy = false;
let last = { code: '', at: 0 };
const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true })!;
let wakeLock: any = null;

function camMessage(text: string | null) {
  $('#cam-msg').hidden = !text;
  $('#frame').hidden = $('#hint').hidden = !!text;
  if (text) $('#cam-msg-text').textContent = text;
}

async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    camMessage('هذا المتصفح لا يدعم الكاميرا. استخدم Chrome أو Safari، أو اكتب الرمز يدوياً.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    camMessage(null);
    const track = stream.getVideoTracks()[0];
    const caps: any = track.getCapabilities?.() || {};
    $('#torch').hidden = !caps.torch;
    running = true;
    loop();
    try { wakeLock = await (navigator as any).wakeLock?.request('screen'); } catch {}
  } catch (e) {
    const name = (e as Error).name;
    camMessage(name === 'NotAllowedError'
      ? 'اسمح للمتصفح باستخدام الكاميرا من إعدادات الموقع، ثم اضغط «تشغيل الكاميرا».'
      : 'تعذر تشغيل الكاميرا. أغلق أي تطبيق آخر يستخدمها ثم حاول مرة أخرى.');
  }
}

function stopCamera() {
  running = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  try { wakeLock?.release(); } catch {}
  wakeLock = null;
}

async function setupDetector() {
  const BD = (window as any).BarcodeDetector;
  if (!BD) return;
  try {
    const formats: string[] = await BD.getSupportedFormats();
    if (formats.includes('qr_code')) detector = new BD({ formats: ['qr_code'] });
  } catch {}
}

let lastScanAt = 0;
async function loop() {
  if (!running) return;
  requestAnimationFrame(loop);
  const now = performance.now();
  if (busy || now - lastScanAt < 110 || video.readyState < 2) return;
  lastScanAt = now;
  const raw = await readFrame();
  if (raw) onCode(raw);
}

async function readFrame(): Promise<string | null> {
  try {
    if (detector) {
      const found = await detector.detect(video);
      return found[0]?.rawValue || null;
    }
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    // Look only at the centre square, scaled down: faster and matches the on-screen frame.
    const side = Math.min(vw, vh) * 0.8;
    const size = Math.min(560, Math.round(side));
    work.width = work.height = size;
    wctx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, size, size);
    const img = wctx.getImageData(0, 0, size, size);
    return jsQR(img.data, size, size, { inversionAttempts: 'dontInvert' })?.data || null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ scan
async function onCode(raw: string) {
  const code = (raw.match(/\/t\/([A-Za-z0-9]{8,16})/)?.[1] || raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code === last.code && Date.now() - last.at < 4000) return;
  last = { code, at: Date.now() };
  busy = true;
  $('#frame').classList.add('is-paused');
  const r = await staff('fest-gate', key, { action: 'scan', code: raw, gate: gateName });
  if (r.status === 401) { $('#logout').click(); busy = false; return; }
  const result = r.ok ? r.data.result : 'error';
  show(result, r.data);
  refreshStats();
}

const TEXT: Record<string, { title: string; icon: string }> = {
  admitted: { title: 'ادخل، أهلاً بك!', icon: 'ico-ok' },
  already_used: { title: 'استُخدمت من قبل', icon: 'ico-warn' },
  not_verified: { title: 'التذكرة غير مؤكدة', icon: 'ico-bad' },
  unknown: { title: 'تذكرة غير معروفة', icon: 'ico-bad' },
  error: { title: 'تعذر التحقق', icon: 'ico-warn' },
};

let dismissTimer = 0;
function show(result: string, d: any) {
  const box = $('#result');
  const info = TEXT[result] ?? TEXT.error;
  box.dataset.r = result;
  $('#r-title').textContent = info.title;
  $('#r-icon').replaceChildren(($(`#${info.icon}`) as HTMLTemplateElement).content.cloneNode(true));
  $('#r-name').textContent = d?.name || '';
  let sub = '';
  if (result === 'already_used' && d.checked_in_at) sub = `دخل ${formatDateTime(d.checked_in_at, 'ar')}${d.checked_in_by ? ` · ${d.checked_in_by}` : ''}`;
  else if (result === 'not_verified') sub = d.status === 'review' ? 'الدفع ما زال قيد المراجعة. وجّه صاحبها إلى المنظمين.' : 'الدفع مرفوض. وجّه صاحبها إلى المنظمين.';
  else if (result === 'unknown') sub = 'هذا الرمز ليس من تذاكر الاحتفال.';
  else if (result === 'error') sub = 'تأكد من الإنترنت ثم امسح مرة أخرى.';
  $('#r-sub').textContent = sub;
  box.hidden = false;
  feedback(result);
  addRecent(result, d?.name || d?.code || '');
  clearTimeout(dismissTimer);
  dismissTimer = window.setTimeout(dismiss, result === 'admitted' ? 2200 : 6000);
}

function dismiss() {
  clearTimeout(dismissTimer);
  $('#result').hidden = true;
  $('#frame').classList.remove('is-paused');
  busy = false;
}
$('#result').addEventListener('click', dismiss);
document.addEventListener('keydown', (e) => { if (!$('#result').hidden && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); dismiss(); } });

let audio: AudioContext | null = null;
function feedback(result: string) {
  const ok = result === 'admitted';
  try { navigator.vibrate?.(ok ? 120 : [200, 90, 200, 90, 200]); } catch {}
  try {
    audio ||= new AudioContext();
    const tones = ok ? [880, 1320] : [300, 220];
    tones.forEach((f, i) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      o.frequency.value = f;
      o.type = ok ? 'sine' : 'square';
      g.gain.value = 0.12;
      o.connect(g).connect(audio!.destination);
      const t0 = audio!.currentTime + i * 0.13;
      o.start(t0);
      o.stop(t0 + 0.12);
    });
  } catch {}
}

function addRecent(result: string, label: string) {
  const ul = $('#recent');
  const li = document.createElement('li');
  li.dataset.r = result;
  li.textContent = `${result === 'admitted' ? '✓' : result === 'already_used' ? '!' : '✕'} ${label}`.trim();
  ul.prepend(li);
  while (ul.children.length > 8) ul.lastElementChild!.remove();
}

$('#manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('#manual-code');
  const v = input.value.trim();
  if (!v) return;
  last = { code: '', at: 0 };
  input.value = '';
  input.blur();
  onCode(v);
});

async function refreshStats() {
  const r = await staff('fest-gate', key, { action: 'stats' });
  if (r.ok) {
    $('#c-in').textContent = String(r.data.admitted);
    $('#c-valid').textContent = String(r.data.valid);
  }
}

$('#torch').addEventListener('click', async () => {
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  const on = $('#torch').getAttribute('aria-pressed') !== 'true';
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as any] });
    $('#torch').setAttribute('aria-pressed', String(on));
  } catch {}
});
$('#flip').addEventListener('click', () => { facing = facing === 'environment' ? 'user' : 'environment'; startCamera(); });
$('#cam-retry').addEventListener('click', startCamera);
document.addEventListener('visibilitychange', () => {
  if (!key || $('#gate').hidden) return;
  if (document.visibilityState === 'hidden') stopCamera();
  else startCamera();
});

let statsTimer = 0;
async function start() {
  $('#login').hidden = true;
  $('#gate').hidden = false;
  await setupDetector();
  startCamera();
  refreshStats();
  clearInterval(statsTimer);
  statsTimer = window.setInterval(refreshStats, 20_000);
}

if (key) {
  staff('fest-gate', key, { action: 'login' }).then((r) => (r.ok ? start() : sessionStorage.removeItem(S_KEY)));
}

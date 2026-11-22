// Draws the theatre from the organisers' plan (stage, 21 rows of left, middle and right blocks) as buttons, one per seat.
// Used by the invitation page, the leaders' page and the admin board.
import { PHASES, SECTIONS, THEATRE, VIP_ROWS, WIDEST, rowLetter, seatId, seatLabel } from '../lib/seats';
import { lang, t } from './lang';

export type SeatState = 'free' | 'selected' | 'taken' | 'held' | 'review' | 'in' | 'vip' | 'blocked' | 'locked';

const STATE_TEXT: Record<SeatState, [string, string]> = {
  free: ['متاح', 'available'],
  selected: ['اخترته', 'selected'],
  taken: ['محجوز', 'booked'],
  held: ['يُحجز الآن', 'being booked'],
  review: ['قيد المراجعة', 'in review'],
  in: ['دخل صاحبه', 'checked in'],
  vip: ['كبار الزوار، يحجزه المنظمون فقط', 'VIP, given out by the organisers'],
  blocked: ['غير متاح', 'not available'],
  locked: ['يفتح في مرحلة قادمة', 'opens in a later phase'],
};

export interface SeatMap {
  set(id: string, state: SeatState, note?: string): void;
  state(id: string): SeatState;
  ids(): string[];
  /** How many of the PHASES are open; updates the phase headings on the plan. */
  setPhase(open: number): void;
}

/**
 * Builds the map inside `host`. `onPick` runs when a seat is tapped. Only free (and chosen) seats can be
 * tapped, plus any states listed in `alsoPick` (the admin's ticket form adds 'vip'); `pickAny` makes every
 * seat tappable (the admin uses it to see who sits where).
 */
export function mountSeatMap(host: HTMLElement, onPick: (id: string) => void, opts: { pickAny?: boolean; alsoPick?: SeatState[] } = {}): SeatMap {
  host.classList.add('theatre');
  host.textContent = '';
  const scroller = document.createElement('div');
  scroller.className = 'theatre__scroll';
  scroller.dir = 'ltr'; // so scrollLeft means the same thing in Arabic and English
  const inner = document.createElement('div');
  inner.className = 'theatre__in';
  inner.dir = 'ltr'; // left and right as seen from the seats, facing the stage

  const stage = document.createElement('div');
  stage.className = 'theatre__stage';
  stage.innerHTML = '<span class="ar">المسرح</span><span class="en">Stage</span>';
  inner.append(stage);

  const grid = document.createElement('div');
  grid.className = 'theatre__grid';
  grid.style.setProperty('--wl', String(WIDEST.L));
  grid.style.setProperty('--wm', String(WIDEST.M));
  grid.style.setProperty('--wr', String(WIDEST.R));
  const cell = (cls: string, text = '') => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
  };
  const both = (ar: string, en: string) => `<span class="ar" dir="rtl">${ar}</span><span class="en" dir="ltr">${en}</span>`; // the map itself is laid out left to right
  // Block headings.
  grid.append(cell('theatre__corner'));
  SECTIONS.forEach((s, i) => {
    if (i) grid.append(cell('theatre__aisle'));
    const h = cell(`theatre__sec theatre__sec--${s.key}`);
    h.innerHTML = both(s.ar, s.en);
    grid.append(h);
  });
  grid.append(cell('theatre__corner'));

  const buttons = new Map<string, HTMLButtonElement>();
  const states = new Map<string, SeatState>();
  const notes = new Map<string, string>();
  const rowsOfIds: string[][] = [];
  const phaseZones: HTMLElement[] = [];
  for (const row of THEATRE) {
    const r = row.row;
    // A heading where each phase after the first starts; setPhase() says whether it is open.
    const pi = PHASES.findIndex((p) => p.from === r);
    if (pi > 0) {
      const z = cell('theatre__zone theatre__zone--phase');
      z.dataset.phase = String(pi + 1);
      z.innerHTML = `<span>${both(`المرحلة ${pi + 1} · ${PHASES[pi].ar}`, `Phase ${pi + 1} · ${PHASES[pi].en}`)}</span>`;
      grid.append(z);
      phaseZones.push(z);
    }
    if (r === 1 && VIP_ROWS) {
      const z = cell('theatre__zone theatre__zone--vip');
      z.innerHTML = `<span>${both(`الوسط: كبار الزوار · الصفوف A – ${THEATRE[VIP_ROWS - 1].label} · يحجزها المنظمون`, `Middle: VIP · rows A – ${THEATRE[VIP_ROWS - 1].label} · given out by the organisers`)}</span>`;
      grid.append(z);
    }
    if (r === VIP_ROWS + 1 && VIP_ROWS) {
      const z = cell('theatre__zone theatre__zone--public');
      z.innerHTML = `<span>${both('مقاعد الجمهور', 'Public seats')}</span>`;
      grid.append(z);
    }
    grid.append(cell('theatre__row theatre__row--start', row.label));
    const inRow: string[] = [];
    SECTIONS.forEach((s, i) => {
      if (i) grid.append(cell('theatre__aisle'));
      const blk = cell(`theatre__blk theatre__blk--${s.key}${row[s.key].vip ? ' theatre__blk--vip' : ''}`);
      for (let n = 1; n <= row[s.key].count; n++) {
        const id = seatId(r, s.key, n);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'seat';
        b.dataset.seat = id;
        b.textContent = String(n);
        buttons.set(id, b);
        states.set(id, 'free');
        inRow.push(id);
        blk.append(b);
      }
      grid.append(blk);
    });
    rowsOfIds.push(inRow);
    grid.append(cell('theatre__row theatre__row--end', row.label));
  }
  inner.append(grid);
  scroller.append(inner);
  const phaseNote = document.createElement('p');
  phaseNote.className = 'theatre__phase';
  phaseNote.setAttribute('role', 'status');
  phaseNote.hidden = true;
  host.append(phaseNote, scroller);

  // On narrow screens part of the theatre is off to the side: say so.
  const hint = document.createElement('p');
  hint.className = 'theatre__hint';
  hint.innerHTML = '<span class="ar">اسحب يميناً ويساراً لرؤية كل المقاعد</span><span class="en">Swipe sideways to see every seat</span>';
  hint.hidden = true;
  host.append(hint);

  // The whole map is one Tab stop; arrow keys move between seats inside it.
  const ids = [...buttons.keys()];
  let rover = '';
  let syncQueued = false;
  const syncTab = () => {
    syncQueued = false;
    const ok = (id: string) => !!id && !buttons.get(id)!.disabled;
    if (!ok(rover)) rover = ids.find((id) => states.get(id) === 'selected') ?? ids.find(ok) ?? ids[0];
    buttons.forEach((b, id) => (b.tabIndex = id === rover ? 0 : -1));
  };
  const queueSync = () => { if (!syncQueued) { syncQueued = true; queueMicrotask(syncTab); } };

  const paint = (id: string) => {
    const b = buttons.get(id)!;
    const st = states.get(id)!;
    b.dataset.state = st;
    b.setAttribute('aria-pressed', String(st === 'selected'));
    b.disabled = !opts.pickAny && st !== 'free' && st !== 'selected' && !(opts.alsoPick ?? []).includes(st);
    const note = notes.get(id);
    b.setAttribute('aria-label', `${seatLabel(id, lang())}، ${t(...STATE_TEXT[st])}${note ? ` · ${note}` : ''}`);
    b.title = b.getAttribute('aria-label')!;
    queueSync();
  };
  buttons.forEach((_, id) => paint(id));
  syncTab();

  grid.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.seat');
    if (!b || b.disabled) return;
    rover = b.dataset.seat!;
    syncTab();
    onPick(rover);
  });

  // ← → within a row, ↑ ↓ to the nearest seat in the next row, Home / End to the ends of the row.
  // Seats that can't be picked are skipped.
  const rowOf = new Map<string, number>();
  rowsOfIds.forEach((ids, r) => ids.forEach((id) => rowOf.set(id, r)));
  const usable = (id: string) => !buttons.get(id)!.disabled;
  const centreX = (id: string) => { const b = buttons.get(id)!.getBoundingClientRect(); return b.left + b.width / 2; };
  grid.addEventListener('keydown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.seat');
    if (!b) return;
    const id = b.dataset.seat!, r = rowOf.get(id)!, inRow = rowsOfIds[r], i = inRow.indexOf(id);
    let next: string | undefined;
    if (e.key === 'ArrowRight') next = inRow.slice(i + 1).find(usable);
    else if (e.key === 'ArrowLeft') next = inRow.slice(0, i).reverse().find(usable);
    else if (e.key === 'Home') next = inRow.find(usable);
    else if (e.key === 'End') next = [...inRow].reverse().find(usable);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const x = centreX(id), step = e.key === 'ArrowDown' ? 1 : -1;
      for (let k = r + step; k >= 0 && k < rowsOfIds.length && !next; k += step) {
        const options = rowsOfIds[k].filter(usable);
        if (options.length) next = options.reduce((best, o) => (Math.abs(centreX(o) - x) < Math.abs(centreX(best) - x) ? o : best));
      }
    } else return;
    e.preventDefault();
    if (!next) return;
    rover = next;
    syncTab();
    buttons.get(next)!.focus();
  });
  document.addEventListener('langchange', () => buttons.forEach((_, id) => paint(id)));

  // Start scrolled to the middle of the centre block on narrow screens.
  const centre = () => { scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2; };
  requestAnimationFrame(centre);
  // Keep it centred (e.g. when a hidden panel opens) until the person scrolls it themselves.
  new ResizeObserver(() => {
    if (!scroller.dataset.moved) centre();
    hint.hidden = scroller.scrollWidth <= scroller.clientWidth + 1;
  }).observe(scroller);
  for (const ev of ['pointerdown', 'wheel', 'touchstart', 'keydown']) scroller.addEventListener(ev, () => { scroller.dataset.moved = '1'; }, { once: true, passive: true });

  return {
    set(id, state, note) {
      if (!buttons.has(id)) return;
      states.set(id, state);
      if (note === undefined) notes.delete(id); else notes.set(id, note);
      paint(id);
    },
    state: (id) => states.get(id) ?? 'free',
    ids: () => [...buttons.keys()],
    setPhase(open) {
      for (const z of phaseZones) {
        const n = Number(z.dataset.phase), p = PHASES[n - 1], isOpen = n <= open;
        z.classList.toggle('theatre__zone--locked', !isOpen);
        z.innerHTML = `<span>${isOpen
          ? both(`المرحلة ${n} · ${p.ar} · مفتوحة`, `Phase ${n} · ${p.en} · open`)
          : both(`المرحلة ${n} · ${p.ar} · تفتح بعد اكتمال المرحلة ${n - 1}`, `Phase ${n} · ${p.en} · opens when phase ${n - 1} is full`)}</span>`;
      }
      phaseNote.hidden = false;
      const p = PHASES[open - 1];
      const seatsAr = open === 1 ? p.ar : `الصفوف A – ${rowLetter(p.to)}`, seatsEn = open === 1 ? p.en : `rows A – ${rowLetter(p.to)}`;
      phaseNote.innerHTML = open >= PHASES.length
        ? both('كل المراحل مفتوحة: اختر من أي صف.', 'Every phase is open: choose from any row.')
        : both(`الحجز الآن في المرحلة ${open} من ${PHASES.length}: ${seatsAr}. تفتح المقاعد التالية عندما تكتمل هذه المرحلة.`,
            `Booking is in phase ${open} of ${PHASES.length}: ${seatsEn}. The next seats open when this phase is full.`);
    },
  };
}

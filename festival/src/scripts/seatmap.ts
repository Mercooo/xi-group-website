// Draws the theatre (stage, 12 rows, left 5 · centre 10 · right 5) as buttons, one per seat.
// Used by the invitation page, the leaders' page and the admin board.
import { ROWS, SECTIONS, seatId, seatLabel } from '../lib/seats';
import { lang, t } from './lang';

export type SeatState = 'free' | 'selected' | 'taken' | 'held' | 'review' | 'in';

const STATE_TEXT: Record<SeatState, [string, string]> = {
  free: ['متاح', 'available'],
  selected: ['اخترته', 'selected'],
  taken: ['محجوز', 'booked'],
  held: ['يُحجز الآن', 'being booked'],
  review: ['قيد المراجعة', 'in review'],
  in: ['دخل صاحبه', 'checked in'],
};

export interface SeatMap {
  set(id: string, state: SeatState, note?: string): void;
  state(id: string): SeatState;
  ids(): string[];
}

/**
 * Builds the map inside `host`. `onPick` runs when a seat is tapped. Seats that are taken
 * are disabled unless `pickAny` is set (the admin uses it to see who sits where).
 */
export function mountSeatMap(host: HTMLElement, onPick: (id: string) => void, opts: { pickAny?: boolean } = {}): SeatMap {
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
  const cell = (cls: string, text = '') => {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
  };
  // Section headings.
  grid.append(cell('theatre__corner'));
  SECTIONS.forEach((s, i) => {
    if (i) grid.append(cell('theatre__aisle'));
    const h = cell(`theatre__sec theatre__sec--${s.key}`);
    h.style.gridColumn = `span ${s.count}`;
    h.innerHTML = `<span class="ar">${s.ar}</span><span class="en">${s.en}</span>`;
    grid.append(h);
  });
  grid.append(cell('theatre__corner'));

  const buttons = new Map<string, HTMLButtonElement>();
  const states = new Map<string, SeatState>();
  const notes = new Map<string, string>();
  for (let r = 1; r <= ROWS; r++) {
    grid.append(cell('theatre__row theatre__row--start', String(r)));
    SECTIONS.forEach((s, i) => {
      if (i) grid.append(cell('theatre__aisle'));
      for (let n = 1; n <= s.count; n++) {
        const id = seatId(r, s.key, n);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'seat';
        b.dataset.seat = id;
        b.textContent = String(n);
        buttons.set(id, b);
        states.set(id, 'free');
        grid.append(b);
      }
    });
    grid.append(cell('theatre__row theatre__row--end', String(r)));
  }
  inner.append(grid);
  scroller.append(inner);
  host.append(scroller);

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
    b.disabled = !opts.pickAny && st !== 'free' && st !== 'selected';
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

  // ← → within a row, ↑ ↓ between rows, Home / End to the ends of the row. Taken seats are skipped.
  const PER_ROW = SECTIONS.reduce((n, s) => n + s.count, 0);
  grid.addEventListener('keydown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.seat');
    if (!b) return;
    const i = ids.indexOf(b.dataset.seat!);
    const rowStart = i - (i % PER_ROW);
    let candidates: number[] = [];
    if (e.key === 'ArrowRight') candidates = Array.from({ length: rowStart + PER_ROW - i - 1 }, (_, k) => i + 1 + k);
    else if (e.key === 'ArrowLeft') candidates = Array.from({ length: i - rowStart }, (_, k) => i - 1 - k);
    else if (e.key === 'ArrowDown') candidates = Array.from({ length: Math.floor((ids.length - 1 - i) / PER_ROW) }, (_, k) => i + PER_ROW * (k + 1));
    else if (e.key === 'ArrowUp') candidates = Array.from({ length: Math.floor(i / PER_ROW) }, (_, k) => i - PER_ROW * (k + 1));
    else if (e.key === 'Home') candidates = Array.from({ length: PER_ROW }, (_, k) => rowStart + k);
    else if (e.key === 'End') candidates = Array.from({ length: PER_ROW }, (_, k) => rowStart + PER_ROW - 1 - k);
    else return;
    e.preventDefault();
    const next = candidates.map((j) => ids[j]).find((id) => !buttons.get(id)!.disabled);
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
  };
}

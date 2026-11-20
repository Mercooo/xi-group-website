// The theatre: one floor, 21 rows, each split into left (L), middle (M) and right (R) blocks whose
// length changes from row to row. The plan lives in theatre.json, drawn by the organisers:
// seat numbers run from the left, as seen facing the stage; `blocked` seats are broken.
// The first five middle rows are VIP: on the plan for everyone, given out by the organisers only.
// Seat ids look like "07-M02" (the 7th row from the stage, middle seat 2) and match fest_seats in the database.
// Rows are lettered from the stage: the 1st row is A, the 21st is U.
import PLAN from './theatre.json';

export interface Block { count: number; blocked: number[]; vip?: boolean }
export interface Row { row: number; label: string; L: Block; M: Block; R: Block }
export const THEATRE = PLAN as Row[];
export const ROWS = THEATRE.length;
export const SECTIONS = [
  { key: 'L', ar: 'يسار', en: 'Left' },
  { key: 'M', ar: 'وسط', en: 'Middle' },
  { key: 'R', ar: 'يمين', en: 'Right' },
] as const;
export type SectionKey = (typeof SECTIONS)[number]['key'];
export const MAX_SEATS = 10;
export const VIP_ROWS = THEATRE.filter((r) => r.M.vip).length;
/** The widest row of each block, so the blocks line up along the aisles. */
export const WIDEST = { L: Math.max(...THEATRE.map((r) => r.L.count)), M: Math.max(...THEATRE.map((r) => r.M.count)), R: Math.max(...THEATRE.map((r) => r.R.count)) };

const pad = (n: number) => String(n).padStart(2, '0');
export const seatId = (row: number, sec: string, n: number) => `${pad(row)}-${sec}${pad(n)}`;
/** The row's letter: row 1 (nearest the stage) is A. */
export const rowLetter = (row: number) => THEATRE[row - 1]?.label ?? String(row);
const parse = (id: string) => ({ row: Number(id.slice(0, 2)), sec: id[3] as SectionKey, n: Number(id.slice(4)) });
export const isVipSeat = (id: string) => { const p = parse(id); return !!THEATRE[p.row - 1]?.[p.sec]?.vip; };
export const isBlockedSeat = (id: string) => { const p = parse(id); return !!THEATRE[p.row - 1]?.[p.sec]?.blocked.includes(p.n); };
/** Kept for older callers: VIP is a middle block, not a whole row. */
export const isVipRow = isVipSeat;

export function seatLabel(id: string, lang: 'ar' | 'en') {
  const { row, sec, n } = parse(id);
  const S = SECTIONS.find((x) => x.key === sec)!;
  return lang === 'ar' ? `صف ${rowLetter(row)} · ${S.ar} ${n}` : `Row ${rowLetter(row)} · ${S.en} ${n}`;
}

/** "صف 3: وسط 5، 6، 7" — seats grouped by row and section, for summaries. */
export function seatsSummary(ids: string[], lang: 'ar' | 'en') {
  const groups = new Map<string, number[]>();
  for (const id of [...ids].sort()) {
    const k = id.slice(0, 4);
    groups.set(k, [...(groups.get(k) ?? []), Number(id.slice(4))]);
  }
  return [...groups].map(([k, ns]) => {
    const S = SECTIONS.find((x) => x.key === k[3])!;
    const r = rowLetter(Number(k.slice(0, 2)));
    return lang === 'ar' ? `صف ${r}: ${S.ar} ${ns.join('، ')}` : `Row ${r}: ${S.en} ${ns.join(', ')}`;
  }).join(' · ');
}

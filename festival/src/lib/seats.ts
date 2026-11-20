// The theatre: one floor, 14 rows, each split into left (5), centre (10) and right (5) seats.
// Seat ids look like "03-M07" (row 3, centre seat 7) and match fest_seats in the database.
// Rows 1-5 are VIP: on the plan for everyone to see, given out by the organisers only.
export const ROWS = 14;
export const VIP_ROWS = 5;
export const isVipRow = (id: string) => Number(id.slice(0, 2)) <= VIP_ROWS;
export const SECTIONS = [
  { key: 'L', count: 5, ar: 'يسار', en: 'Left' },
  { key: 'M', count: 10, ar: 'وسط', en: 'Centre' },
  { key: 'R', count: 5, ar: 'يمين', en: 'Right' },
] as const;
export const MAX_SEATS = 10;

const pad = (n: number) => String(n).padStart(2, '0');
export const seatId = (row: number, sec: string, n: number) => `${pad(row)}-${sec}${pad(n)}`;

export function seatLabel(id: string, lang: 'ar' | 'en') {
  const [r, s] = id.split('-');
  const sec = SECTIONS.find((x) => x.key === s[0])!;
  return lang === 'ar' ? `صف ${Number(r)} · ${sec.ar} ${Number(s.slice(1))}` : `Row ${Number(r)} · ${sec.en} ${Number(s.slice(1))}`;
}

/** "صف 3: وسط 5، 6، 7" — seats grouped by row and section, for summaries. */
export function seatsSummary(ids: string[], lang: 'ar' | 'en') {
  const groups = new Map<string, number[]>();
  for (const id of [...ids].sort()) {
    const [r, s] = id.split('-');
    const k = `${r}-${s[0]}`;
    groups.set(k, [...(groups.get(k) ?? []), Number(s.slice(1))]);
  }
  return [...groups].map(([k, ns]) => {
    const [r, sec] = k.split('-');
    const S = SECTIONS.find((x) => x.key === sec)!;
    return lang === 'ar' ? `صف ${Number(r)}: ${S.ar} ${ns.join('، ')}` : `Row ${Number(r)}: ${S.en} ${ns.join(', ')}`;
  }).join(lang === 'ar' ? ' · ' : ' · ');
}

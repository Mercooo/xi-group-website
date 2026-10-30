import { pages, sites, UNITS, GROUP_NAME, pageText, displayLabel } from '../lib/data';

export function GET() {
  const index = pages.map((p) => {
    const isHome = p.path === sites[p.site].base;
    const unit = UNITS.find((u) => u.key === p.site);
    return {
      t: isHome ? (unit?.name ?? GROUP_NAME) : displayLabel(p.title),
      p: p.path,
      s: p.site,
      u: unit?.name ?? GROUP_NAME,
      x: pageText(p).slice(0, 6000),
    };
  });
  return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

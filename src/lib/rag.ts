/**
 * Retrieval over the site's own pages, for the chat assistant.
 *
 * Every page in pages.json is split into passages of a few paragraphs. Passages
 * are ranked with BM25 over lightly stemmed Arabic words (hamza / ta marbuta /
 * alef maqsura folded, the article and one-letter prefixes stripped), with extra
 * weight for words in the page title and its breadcrumb trail.
 * The index is built once per server instance; it takes a few milliseconds.
 */
import { pages, sites, UNITS, GROUP_NAME, breadcrumbs, displayLabel, type Page } from './data';

export interface Passage {
  id: number;
  path: string;
  /** e.g. "فرقة الكشافين › منهجية الفرقة › المراسم" */
  trail: string;
  title: string;
  unit: string;
  site: string;
  paragraphs: string[];
}

export interface Hit extends Passage { score: number }

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);

/** Paragraphs of a page, in reading order. Headings, list items and paragraphs each become one. */
function paragraphsOf(page: Page): string[] {
  const out: string[] = [];
  for (const s of page.sections)
    for (const r of s.rows)
      for (const c of r)
        for (const b of c.blocks) {
          if (b.type === 'text') {
            const parts = b.html
              .replace(/<br\s*\/?>/g, '\n')
              .replace(/<\/(p|h\d|li|div|tr)>/g, '\n')
              .replace(/<li[^>]*>/g, '• ')
              .replace(/<[^>]+>/g, '')
              .split('\n');
            for (const p of parts) {
              const t = decode(p).replace(/\s+/g, ' ').trim();
              if (t && t !== '•') out.push(t);
            }
          } else if (b.type === 'button' && b.label.trim()) {
            out.push(`[${displayLabel(b.label.trim())}]`);
          } else if (b.type === 'image' && b.alt?.trim()) {
            out.push(`(صورة: ${b.alt.trim()})`);
          }
        }
  // Drop consecutive duplicates (Google Sites often repeats a heading as a button).
  return out.filter((p, i) => p !== out[i - 1]);
}

export const pageTitle = (p: Page) => {
  const isHome = p.path === sites[p.site].base;
  const unit = UNITS.find((u) => u.key === p.site);
  return isHome ? (unit?.name ?? GROUP_NAME) : displayLabel(p.title);
};
const unitName = (p: Page) => UNITS.find((u) => u.key === p.site)?.name ?? GROUP_NAME;
const trailOf = (p: Page) => [...breadcrumbs(p).slice(1).map(pageTitle), pageTitle(p)].join(' › ');

// ---------------------------------------------------------------- normalisation

export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '') // harakat, superscript alef, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/چ/g, 'ج')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

const STOP = new Set(
  'في من الى علي عن مع هو هي هذا هذه ذلك تلك التي الذي الذين ان او ثم كل بعض قد لا ما ماذا كيف متي اين هل لم لن كان كانت يكون تكون وهو وهي عند بين حتي اذا لكن ايضا هناك هنا انا نحن انت انتم هم the a an of to in and or is are what who how when where which for on with about tell me please'.split(' ').map(fold),
);

/** Light Arabic stemmer: strips one conjunction/preposition prefix, the article, and common suffixes. */
function stem(w: string): string {
  if (!/[؀-ۿ]/.test(w)) return w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
  let t = w;
  if (t.length > 4 && /^(وال|بال|كال|فال|لل)/.test(t)) t = t.replace(/^(وال|بال|كال|فال)/, '').replace(/^لل/, '');
  else if (t.length > 3 && t.startsWith('ال')) t = t.slice(2);
  else if (t.length > 4 && /^[وفبكل]ال/.test(t)) t = t.slice(3);
  else if (t.length > 4 && /^[وف]/.test(t)) t = t.slice(1);
  for (const suf of ['يات', 'ات', 'ون', 'ين', 'ان', 'ها', 'هم', 'كم', 'نا', 'يه', 'ه', 'ي']) {
    if (t.length - suf.length >= 3 && t.endsWith(suf)) { t = t.slice(0, -suf.length); break; }
  }
  return t;
}

export function terms(s: string): string[] {
  return fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem)
    .filter((w) => w.length > 1);
}

// ---------------------------------------------------------------- index

const TARGET = 900; // characters per passage, roughly
export const passages: Passage[] = [];
for (const page of pages) {
  const paras = paragraphsOf(page);
  const base = { path: page.path, trail: trailOf(page), title: pageTitle(page), unit: unitName(page), site: page.site };
  if (!paras.length) {
    passages.push({ id: passages.length, ...base, paragraphs: [`صفحة «${base.title}» ضمن ${base.unit}.`] });
    continue;
  }
  let cur: string[] = [];
  let len = 0;
  for (const p of paras) {
    if (len + p.length > TARGET && cur.length) {
      passages.push({ id: passages.length, ...base, paragraphs: cur });
      // Keep the last paragraph as overlap when it is short (usually a heading).
      cur = cur[cur.length - 1].length < 120 ? [cur[cur.length - 1]] : [];
      len = cur.reduce((n, x) => n + x.length, 0);
    }
    cur.push(p);
    len += p.length;
  }
  if (cur.length) passages.push({ id: passages.length, ...base, paragraphs: cur });
}

interface Doc { tf: Map<string, number>; len: number; title: Set<string>; leaf: Set<string> }
const docs: Doc[] = passages.map((p) => {
  const tf = new Map<string, number>();
  const body = terms(p.paragraphs.join(' '));
  for (const t of body) tf.set(t, (tf.get(t) ?? 0) + 1);
  return { tf, len: body.length, title: new Set(terms(`${p.trail} ${p.unit}`)), leaf: new Set(terms(p.title)) };
});
const df = new Map<string, number>();
for (const d of docs) for (const t of new Set([...d.tf.keys(), ...d.title])) df.set(t, (df.get(t) ?? 0) + 1);
const avgLen = docs.reduce((n, d) => n + d.len, 0) / docs.length;
const N = docs.length;
const idf = (t: string) => Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));

/** Rank passages for a query. `unit` limits results to one section of the site. */
export function search(query: string, opts: { limit?: number; unit?: string } = {}): Hit[] {
  const limit = opts.limit ?? 6;
  const q = [...new Set(terms(query))];
  if (!q.length) return [];
  const k1 = 1.4, b = 0.7;
  const phrase = fold(query).trim();
  const scored: Hit[] = [];
  docs.forEach((d, i) => {
    const p = passages[i];
    if (opts.unit && p.site !== opts.unit) return;
    let s = 0;
    let matched = 0;
    for (const t of q) {
      const f = d.tf.get(t) ?? 0;
      const inTitle = d.title.has(t);
      if (!f && !inTitle) continue;
      matched++;
      const w = idf(t);
      s += w * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avgLen)));
      if (inTitle) s += w * (d.leaf.has(t) ? 2.6 : 1);
    }
    if (!s) return;
    s *= 0.6 + 0.4 * (matched / q.length); // reward covering more of the query
    if (phrase.length > 4 && fold(p.paragraphs.join(' ')).includes(phrase)) s *= 1.5;
    scored.push({ ...p, score: s });
  });
  scored.sort((a, b) => b.score - a.score);
  // At most two passages per page, so one long page does not crowd out the rest.
  const perPage = new Map<string, number>();
  const out: Hit[] = [];
  for (const h of scored) {
    const n = perPage.get(h.path) ?? 0;
    if (n >= 2) continue;
    perPage.set(h.path, n + 1);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

/** One line per page, grouped by unit: the map of the site given to the model up front. */
export function siteMap(): string {
  const lines: string[] = [];
  for (const key of ['group', 'buds', 'cubs', 'scouts', 'rovers'] as const) {
    const unit = UNITS.find((u) => u.key === key);
    lines.push(`\n## ${unit ? `${unit.name} (${unit.ages})` : GROUP_NAME}`);
    for (const p of pages.filter((x) => x.site === key)) lines.push(`- ${trailOf(p)} — ${p.path}`);
  }
  return lines.join('\n').trim();
}

export const pageCount = pages.length;

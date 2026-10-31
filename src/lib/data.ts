import pagesJson from '../data/pages.json';
import sitesJson from '../data/sites.json';

export type Block =
  | { type: 'text'; html: string }
  | { type: 'image'; src: string; alt: string; href?: string; external?: boolean; width?: number; height?: number; crop?: { w: number; t: number; b: number; l: number } }
  | { type: 'button'; label: string; href: string; external: boolean }
  | { type: 'spacer'; height: number }
  | { type: 'divider' }
  | { type: 'embed'; src: string; ratio: number }
  | { type: 'iframe'; src: string; title: string; ratio: number }
  | { type: 'carousel'; images: string[]; ratio: number }
  | { type: 'social'; links: { name: string; href: string }[] }
  | { type: 'placeholder'; ratio: number };

export interface Column { span: number; blocks: Block[] }
export interface Section { style: 'header' | 'default' | 'subtle' | 'plain' | 'accent'; bg: string | null; rows: Column[][] }
export interface Page { site: SiteKey; path: string; source: string; title: string; description: string; sections: Section[] }
export interface NavItem { label: string; href: string; external: boolean; children?: NavItem[] }
export interface Site { key: SiteKey; base: string; googleUrl: string; title: string; logo: string | null; accent: string | null; nav: NavItem[] }
export type SiteKey = 'group' | 'buds' | 'cubs' | 'scouts' | 'rovers';

export const pages = pagesJson as Page[];
export const sites = sitesJson as unknown as Record<SiteKey, Site>;

/** Arabic display names and colours for each unit, in age order. */
export const UNITS: { key: Exclude<SiteKey, 'group'>; name: string; short: string; ages: string }[] = [
  { key: 'buds', name: 'وحدة البراعم', short: 'البراعم', ages: '3 – 6 سنوات' },
  { key: 'cubs', name: 'زمرة الأشبال', short: 'الأشبال', ages: '6 – 10.5 سنوات' },
  { key: 'scouts', name: 'فرقة الكشافين', short: 'الكشافين', ages: '10.5 – 16 سنة' },
  { key: 'rovers', name: 'عشيرة الجوالة', short: 'الجوالة', ages: '16 سنة فأكثر' },
];

export const GROUP_NAME = 'المجموعة الحادية عشر';
export const GROUP_SUBTITLE = 'كشافة ومرشدات وادي النيل في القاهرة';

const byPath = new Map(pages.map((p) => [p.path, p]));
export const getPage = (path: string) => byPath.get(path);

/** Order pages the way the original navigation lists them; unlisted pages keep crawl order. */
const navOrder = new Map<string, number>();
for (const site of Object.values(sites)) {
  const walk = (items: NavItem[]) => {
    for (const it of items) {
      if (!it.external && !navOrder.has(it.href)) navOrder.set(it.href, navOrder.size);
      if (it.children) walk(it.children);
    }
  };
  walk(site.nav);
}
const crawlOrder = new Map(pages.map((p, i) => [p.path, i]));
const sortKey = (p: Page) => (navOrder.get(p.path) ?? 10_000) + (crawlOrder.get(p.path) ?? 0) / 100_000;

/** Nearest existing ancestor page (e.g. /cubs/home/x -> /cubs). */
export function parentOf(path: string): Page | undefined {
  if (path === '/') return undefined;
  let segs = path.split('/').filter(Boolean);
  while (segs.length) {
    segs = segs.slice(0, -1);
    const candidate = '/' + segs.join('/');
    const page = byPath.get(candidate === '/' ? '/' : candidate);
    if (page) return page;
  }
  return byPath.get('/');
}

const childrenMap = new Map<string, Page[]>();
for (const p of pages) {
  const parent = parentOf(p.path);
  if (!parent) continue;
  if (!childrenMap.has(parent.path)) childrenMap.set(parent.path, []);
  childrenMap.get(parent.path)!.push(p);
}
for (const list of childrenMap.values()) list.sort((a, b) => sortKey(a) - sortKey(b));

export const childrenOf = (path: string) => childrenMap.get(path) ?? [];

export function breadcrumbs(page: Page): Page[] {
  const trail: Page[] = [];
  let cur = parentOf(page.path);
  while (cur) {
    trail.unshift(cur);
    cur = parentOf(cur.path);
  }
  return trail;
}

export function siblings(page: Page): { prev?: Page; next?: Page } {
  const parent = parentOf(page.path);
  if (!parent || page.path === sites[page.site].base) return {};
  // Step only between pages of the same folder (patrols with patrols, not with the unit's sections).
  const dir = (path: string) => path.split('/').slice(0, -1).join('/');
  const list = childrenOf(parent.path).filter((p) => p.site === page.site && p.path !== sites[p.site].base && dir(p.path) === dir(page.path));
  const i = list.findIndex((p) => p.path === page.path);
  return { prev: list[i - 1], next: list[i + 1] };
}

/** Plain text of a page, for search and meta descriptions. */
export function pageText(page: Page): string {
  const parts: string[] = [];
  for (const s of page.sections)
    for (const r of s.rows)
      for (const c of r)
        for (const b of c.blocks) {
          if (b.type === 'text') parts.push(b.html.replace(/<br>/g, ' ').replace(/<\/(p|h\d|li)>/g, ' ').replace(/<[^>]+>/g, ''));
          if (b.type === 'button') parts.push(b.label);
        }
  return parts
    .join(' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Arabic names for the few labels the Google Sites had in English. */
const LABELS: Record<string, string> = {
  Home: 'الرئيسية',
  'Our Events': 'فعالياتنا',
  'Upcoming Events': 'الفعاليات القادمة',
  'Latest Events': 'أحدث الفعاليات',
  'XI Archive': 'أرشيف المجموعة',
  'Download as PDF': 'تحميل بصيغة PDF',
  'Wadi El Nil Scout Store': 'متجر وادي النيل الكشفي',
};

export function displayLabel(label: string) {
  return LABELS[label.trim()] ?? label;
}

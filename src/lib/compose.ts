// Turns the Google Sites grid (sections → rows → columns → blocks) into
// content groups with a purpose: leader cards, link lists, image + text,
// galleries and running text. Google Sites pages were laid out by hand on a
// 12-column grid; reproducing that grid literally produced lonely buttons and
// huge empty boxes, so pages are re-composed from what their content is.
import { childrenOf, type Block, type Page, type Section } from './data';

type ImageBlock = Extract<Block, { type: 'image' }>;
type ButtonBlock = Extract<Block, { type: 'button' }>;

export interface PersonItem { image?: ImageBlock; html: string }
export interface LinkItem { label: string; href: string; external: boolean; image?: ImageBlock }

export type Group =
  | { kind: 'prose'; html: string }
  | { kind: 'media'; image: ImageBlock; html: string }
  | { kind: 'people'; items: PersonItem[] }
  | { kind: 'links'; items: LinkItem[] }
  | { kind: 'gallery'; images: ImageBlock[] }
  | { kind: 'block'; block: Block; span: number };

const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim();
const textLen = (blocks: Block[]) => blocks.reduce((n, b) => n + (b.type === 'text' ? plain(b.html).length : 0), 0);
const isPicture = (b: Block) => b.type === 'image' || b.type === 'placeholder';

/** Clean imported rich text: demote headings under the page h1, drop Google's
 * alignment, collapse blank lines and turn "-----القرار-----" lines into labels. */
export function cleanHtml(html: string) {
  return html
    .replace(/<(\/?)h([1-5])\b/g, (_, slash, n) => `<${slash}h${Math.min(+n + 1, 6)}`)
    .replace(/ class="ta-(?:center|left|right|justify)"/g, '')
    .replace(/(<br>\s*){2,}/g, '<br>')
    .replace(/^(\s*<br>)+|(<br>\s*)+$/g, '')
    .replace(/<p([^>]*)>\s*-{4,}\s*([^<-][^<]*?)\s*-{4,}\s*<\/p>/g, '<p$1 class="refrain">$2</p>')
    .replace(/<p([^>]*)>\s*-{6,}\s*<\/p>/g, '<hr class="rule">')
    .replace(/-{6,}\s*([^<-][^<]*?)\s*-{6,}/g, '<span class="refrain">$1</span>')
    .replace(/-{6,}/g, '');
}

/** Buttons Google Sites pages used as a hand-made "back" menu: links to the
 * page itself or to one of its ancestors. Breadcrumbs cover these now. */
function isBackLink(b: ButtonBlock, page: Page) {
  if (b.external) return false;
  const href = decodeURI(b.href.split('#')[0]) || '/';
  if (href === page.path) return true;
  if (href === '/') return true;
  return page.path.startsWith(href + '/');
}

function rowGroups(row: { span: number; blocks: Block[] }[]): Group[] {
  const cols = row.map((c) => c.blocks);
  const all = cols.flat();
  if (!all.length) return [];

  // Link list: every block is a button, optionally paired with a picture.
  if (all.some((b) => b.type === 'button') && all.every((b) => b.type === 'button' || b.type === 'image')) {
    const items: LinkItem[] = [];
    for (const col of cols) {
      const img = col.find((b) => b.type === 'image') as ImageBlock | undefined;
      col.filter((b): b is ButtonBlock => b.type === 'button').forEach((b, i) =>
        items.push({ label: b.label, href: b.href, external: b.external, image: i === 0 ? img : undefined }),
      );
    }
    return [{ kind: 'links', items }];
  }

  // People: each column is at most one picture plus a short caption.
  const personCol = (col: Block[]) =>
    col.every((b) => b.type === 'text' || isPicture(b)) &&
    col.filter(isPicture).length <= 1 &&
    (textLen(col) > 0 || col.some(isPicture)) &&
    textLen(col) <= 170;
  if (cols.length >= 2 ? cols.every(personCol) : cols.length === 1 && personCol(cols[0]) && cols[0].some(isPicture)) {
    const items = cols
      .map((col) => ({
        image: col.find((b) => b.type === 'image') as ImageBlock | undefined,
        html: col.filter((b) => b.type === 'text').map((b) => cleanHtml((b as any).html)).join(''),
      }))
      .filter((p) => p.image || plain(p.html)); // an unnamed empty frame says nothing
    return items.length ? [{ kind: 'people', items }] : [];
  }

  // Image beside text.
  if (cols.length === 2) {
    const [a, b] = cols;
    const onlyImg = (c: Block[]) => c.length === 1 && c[0].type === 'image';
    const onlyText = (c: Block[]) => c.every((x) => x.type === 'text');
    const pair = onlyImg(a) && onlyText(b) ? [a, b] : onlyImg(b) && onlyText(a) ? [b, a] : null;
    if (pair && textLen(pair[1]) > 170) {
      return [{ kind: 'media', image: pair[0][0] as ImageBlock, html: pair[1].map((x) => cleanHtml((x as any).html)).join('') }];
    }
  }

  // Anything else: flatten in reading order. A lead-in line ending with ":"
  // ("to listen to the song, press here:") goes before the player it introduces.
  const out: Group[] = [];
  const leadIn = (b: Block) => b.type === 'text' && /[:：]\s*$/.test(plain(b.html));
  const spanOf = new Map<Block, number>();
  row.forEach((c) => c.blocks.forEach((b) => spanOf.set(b, c.span)));
  const ordered = [...all.filter(leadIn), ...all.filter((b) => !leadIn(b))];
  for (const b of ordered) {
    if (b.type === 'text') out.push({ kind: 'prose', html: cleanHtml(b.html) });
    else if (b.type === 'image') out.push({ kind: 'gallery', images: [b] });
    else if (b.type === 'button') out.push({ kind: 'links', items: [{ label: b.label, href: b.href, external: b.external }] });
    else if (b.type === 'spacer' || b.type === 'placeholder') continue;
    else out.push({ kind: 'block', block: b, span: spanOf.get(b) ?? 12 });
  }
  return out;
}

function merge(groups: Group[]): Group[] {
  const out: Group[] = [];
  for (const g of groups) {
    const last = out[out.length - 1];
    if (last && last.kind === g.kind) {
      if (g.kind === 'prose' && last.kind === 'prose') { last.html += g.html; continue; }
      if (g.kind === 'people' && last.kind === 'people') { last.items.push(...g.items); continue; }
      if (g.kind === 'links' && last.kind === 'links') { last.items.push(...g.items); continue; }
      if (g.kind === 'gallery' && last.kind === 'gallery') { last.images.push(...g.images); continue; }
    }
    out.push(g);
  }
  // A lone heading-like line before a people grid is its title, keep it as prose;
  // drop prose that became empty after cleaning.
  return out.filter((g) => g.kind !== 'prose' || plain(g.html).length > 0);
}

export function composePage(page: Page, title: string): { hero?: Section; groups: Group[] } {
  const [first, ...rest] = page.sections;
  const hero = first?.style === 'header' ? first : undefined;
  const sections = hero ? rest : page.sections;
  const groups: Group[] = [];
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  for (const s of sections) {
    for (const row of s.rows) {
      const cols = row
        .map((c) => ({
          span: c.span,
          blocks: c.blocks.filter((b) => {
            if (b.type === 'spacer' || b.type === 'divider') return false;
            if (b.type === 'button' && isBackLink(b, page)) return false;
            if (b.type === 'text' && norm(plain(b.html)) === norm(title)) return false;
            return true;
          }),
        }))
        .filter((c) => c.blocks.length);
      groups.push(...rowGroups(cols));
    }
  }
  return { hero, groups: merge(groups) };
}

/** First real picture on a page, used as the thumbnail of links pointing to it. */
export function pageThumbnail(page: Page): ImageBlock | undefined {
  return ownThumbnail(page) ?? childrenOf(page.path).map(ownThumbnail).find(Boolean);
}

// Scanned requirement sheets make poor thumbnails; keep roughly square pictures.
const thumbFriendly = (b: ImageBlock) => !b.width || !b.height || (b.width / b.height > 0.6 && b.width / b.height < 1.7);

function ownThumbnail(page: Page): ImageBlock | undefined {
  const [first, ...rest] = page.sections;
  const sections = first?.style === 'header' ? rest : page.sections;
  for (const s of sections)
    for (const r of s.rows)
      for (const c of r)
        for (const b of c.blocks) if (b.type === 'image') return thumbFriendly(b) ? b : undefined;
  return undefined;
}

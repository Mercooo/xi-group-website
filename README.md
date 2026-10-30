# XI Group website — المجموعة الحادية عشر

The website of the 11th Group, Scouts & Guides Wadi El Nil (SGWEN), Cairo.
It replaces five Google Sites with one fast static site:

| Section | Google Site | New path |
| --- | --- | --- |
| Group (المجموعة) | `sites.google.com/view/xi-group` | `/` |
| Buds (البراعم) | `sites.google.com/view/xi-buds` | `/buds` |
| Cubs (الأشبال) | `sites.google.com/view/xi-cubs` | `/cubs` |
| Scouts (الكشافين) | `sites.google.com/view/xiscouts` | `/scouts` |
| Rovers (الجوالة) | `sites.google.com/view/xi-rovers` | `/rovers` |

All 298 pages are included: history, units and leaders, sixes and patrols,
every badge, knots and lashings, ceremonies, songs (with their SoundCloud
players), services and admin pages. Each unit keeps its colour from its Google
Site. Old `sites.google.com/view/...` paths redirect to the new ones
(see `vercel.json`).

Extras the Google Sites didn't have: full-site Arabic search (`/search`, it
ignores hamza/ta-marbuta spelling differences), breadcrumbs, previous/next links
between sibling pages, a mobile menu with the whole page tree, a sitemap,
share links, and a 404 page.

## Develop

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
```

Built with [Astro](https://astro.build); there is no server code.

## Where the content lives

- `src/data/pages.json` — every page as sections → rows → columns → blocks
  (text, image, button, embed, carousel, …). Text blocks are plain HTML.
- `src/data/sites.json` — title, logo, colour and menu of the group and each unit.
- `public/embeds/` — the custom embeds (SoundCloud players, draw.io charts).

To change a page, edit its entry in `pages.json` (search for the page's path).

## Re-import from Google Sites

If someone keeps editing the Google Sites, pull the changes again:

```sh
pip install beautifulsoup4 pillow
npm run import                       # re-crawl and regenerate src/data
npm run import -- --download-images  # also save images into public/images
```

## Images

Google serves Google Sites images with `Cross-Origin-Resource-Policy: same-site`,
so browsers only show them on sites.google.com. For them to appear here they must
be downloaded into `public/images` (`--download-images` above) and committed.
Until then, image blocks that can't load are hidden instead of showing as broken.

## Deploy

Pushes to `main` deploy to Vercel automatically (framework preset: Astro).
After you attach a custom domain, set `SITE_URL` (e.g. `https://xi-group.org`)
in the Vercel project's environment variables so canonical links and the
sitemap use it.

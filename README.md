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

## Site assistant (chatbot)

Every page has an **اسأل المجموعة** button (and a ✦ button in the header) that
opens a chat assistant. It answers questions about scouting and the group in
Arabic or English using only this site's content, and cites the pages it used.

How it works:

- `src/lib/rag.ts` splits all pages into ~430 passages and ranks them with BM25
  over lightly stemmed Arabic (hamza, ta marbuta and alef maqsura folded, the
  article and one-letter prefixes stripped). Page titles count extra.
- `src/pages/api/chat.ts` is the only server code (a Vercel Function). It gives
  the model a `search_site` tool over that index plus a map of every page. The
  model writes its own Arabic search queries (so English questions work), may
  search several times, and cites the passages it used. The answer streams to
  the browser as newline-delimited JSON.
- Two model providers, in `src/lib/assistant/`: **Google Gemini** (free tier;
  told to write `[n]` after each claim, which the server turns into citations)
  and **Claude** (native citations through `search_result` blocks).
- `src/components/Chat.astro` is the chat panel: streamed answers, the searches
  it ran, numbered citation chips, source cards linking to the pages, suggested
  questions, copy / retry, full screen on phones, RTL and LTR text. The
  conversation survives page navigation (sessionStorage).

Settings (Vercel → Project → Settings → Environment Variables):

Set **one** API key. Gemini is used when its key is present.

| Variable | Default | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Free key from [Google AI Studio](https://aistudio.google.com/apikey). Free tier has per-minute and per-day limits, and Google may use free-tier prompts to improve its products. |
| `GEMINI_MODEL` | `gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite` | Comma-separated Gemini models, tried in order: when one is overloaded or rate limited the next answers. |
| `ANTHROPIC_API_KEY` | — | Paid key from console.anthropic.com, for Claude. |
| `CHAT_MODEL` | `claude-opus-5-5` | Claude model, e.g. `claude-sonnet-5-5` for lower cost. |
| `CHAT_EFFORT` | `low` | Claude only: `low`, `medium` or `high`. |
| `CHAT_PROVIDER` | auto | `gemini` or `anthropic`, to choose when both keys are set. |

Without a key the panel says the assistant is not enabled. Redeploy after
changing a variable.

The API keeps the last 16 messages (with Claude it also caches the prompt),
caps questions at 2000 characters and allows 20 questions per visitor IP per
10 minutes.

## Develop

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
```

Built with [Astro](https://astro.build). Pages are static; the only server code is
the chat endpoint (`/api/chat`). To try the assistant locally, put
`ANTHROPIC_API_KEY=...` in a `.env` file before `npm run dev`.

## Where the content lives

- `src/data/pages.json` — every page as sections → rows → columns → blocks
  (text, image, button, embed, carousel, …). Text blocks are plain HTML.
- `src/data/sites.json` — title, logo, colour and menu of the group and each unit.
- `public/embeds/` — the custom embeds (SoundCloud players, draw.io charts).

To change a page, edit its entry in `pages.json` (search for the page's path).

Pages are not drawn on Google's 12-column grid. `src/lib/compose.ts` reads what
each row contains and picks a layout for it: leader cards (photo + name), link
lists or picture tiles, image beside text, galleries and running text. The
hand-made "back to…" buttons from Google Sites are dropped because every page
has breadcrumbs. Each unit is themed with its own colour (see the tokens at the
top of `src/styles/global.css`).

## Re-import from Google Sites

If someone keeps editing the Google Sites, pull the changes again:

```sh
pip install beautifulsoup4 pillow
npm run import                       # re-crawl and regenerate src/data
npm run import -- --download-images  # also self-host images (see Images below)
```

## Images

Google serves Google Sites images with `Cross-Origin-Resource-Policy: same-site`,
so browsers only show them on sites.google.com. That is why every image is
self-hosted in `public/images` (WebP, max 1600px wide).

Google also refuses plain downloads of these images, so new images are captured
by opening the Google Sites pages in a headless browser and keeping the images
those pages load:

```sh
npm i -D playwright && npx playwright install chromium
python3 -c "import json; json.dump([p['source'] for p in json.load(open('src/data/pages.json'))], open('.cache/google-sites/page-urls.json','w'))"
mkdir -p .cache/google-sites/img
node scripts/capture_images.cjs .cache/google-sites/page-urls.json .cache/google-sites/img
npm run import -- --download-images   # converts the captured images and rewrites the URLs
```

## Deploy

Pushes to `main` deploy to Vercel automatically (framework preset: Astro).
After you attach a custom domain, set `SITE_URL` (e.g. `https://xi-group.org`)
in the Vercel project's environment variables so canonical links and the
sitemap use it.

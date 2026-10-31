// Visits the Google Sites pages like a reader, scrolls to load every image,
// and saves both the page HTML and the images that same page load fetched.
// Google signs image URLs per page load, so the HTML and images must come
// from the same visit for scripts/import_google_sites.py to match them up.
//
// Usage: node scripts/capture_images.cjs <page-urls.json> <cache-dir>
//   writes <cache-dir>/<md5(path)[:12]>.html and <cache-dir>/img/<md5(url)[:16]>.webp.bin
const fs = require('fs');
const crypto = require('crypto');
const { chromium } = require('playwright');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

(async () => {
  const urls = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const dir = process.argv[3];
  fs.mkdirSync(`${dir}/img`, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const sizes = new Map();
  context.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/sitesv-images-rt/') || !res.ok()) return;
    const key = url.replace(/=[a-z0-9-]+$/, '');
    try {
      const body = await res.body();
      if ((sizes.get(key) || 0) >= body.length) return; // keep the largest size seen
      sizes.set(key, body.length);
      fs.writeFileSync(`${dir}/img/${md5(key).slice(0, 16)}.webp.bin`, body);
    } catch {}
  });

  let done = 0;
  const queue = [...urls];
  async function worker() {
    const page = await context.newPage();
    while (queue.length) {
      const url = queue.shift();
      try {
        const res = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
        const path = decodeURIComponent(new URL(url).pathname).replace(/\/$/, '');
        fs.writeFileSync(`${dir}/${md5(path).slice(0, 12)}.html`, await res.text());
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 700) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 150));
          }
        });
        await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      } catch (e) {
        console.error('page failed', url, e.message);
      }
      if (++done % 25 === 0) console.log(`  ${done}/${urls.length} pages`);
    }
    await page.close();
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`captured ${sizes.size} images from ${urls.length} pages`);
  await browser.close();
  process.exit(0);
})();

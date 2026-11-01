import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

// Set SITE_URL in Vercel (Project → Settings → Environment Variables) once a
// custom domain is attached; it is used for canonical URLs and the sitemap.
const site = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://xi-group.vercel.app');

export default defineConfig({
  site,
  trailingSlash: 'never',
  // Pages stay static; only /api/chat runs as a Vercel Function (see src/pages/api/chat.ts).
  adapter: vercel(),
  integrations: [sitemap({ filter: (page) => !page.includes('/api/') })],
});

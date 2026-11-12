import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://xi-festival-74.vercel.app'),
  trailingSlash: 'never',
  build: { format: 'file' },
});

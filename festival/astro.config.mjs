import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://xi-festival-74.vercel.app'),
  trailingSlash: 'never',
  build: { format: 'file' },
  // Pages stay static; only /api/ocr (free receipt text recognition) runs as a Vercel Function.
  adapter: vercel({
    maxDuration: 60,
    // Tesseract starts its worker and WebAssembly core from paths the bundler can't see.
    includeFiles: [
      './node_modules/tesseract.js/src/worker-script/node/index.js',
      ...['', '-simd', '-lstm', '-simd-lstm'].flatMap((v) => [
        `./node_modules/tesseract.js-core/tesseract-core${v}.js`,
        `./node_modules/tesseract.js-core/tesseract-core${v}.wasm`,
        `./node_modules/tesseract.js-core/tesseract-core${v}.wasm.js`,
      ]),
    ],
  }),
});

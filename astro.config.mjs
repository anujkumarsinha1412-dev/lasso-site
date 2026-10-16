import { defineConfig } from 'astro/config';
import consultationCta from './src/lib/consultation-cta.js';
import sitemap from '@astrojs/sitemap';

// TODO: change `site` to the final custom domain once purchased.
export default defineConfig({
  site: 'https://agenquest.com',
  integrations: [sitemap()],
  markdown: { remarkPlugins: [consultationCta] },
});

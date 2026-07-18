import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// TODO: change `site` to the final custom domain once purchased.
export default defineConfig({
  site: 'https://lasso-site.pages.dev',
  integrations: [sitemap()],
});

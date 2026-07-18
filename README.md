# Lasso — website + blog

Static site built with Astro. Homepage is hand-crafted HTML in `public/index.html`; blog posts are markdown in `src/blog/`.

## Publish a blog post
1. Add a `.md` file to `src/blog/` with frontmatter: `title`, `description`, `date` (YYYY-MM-DD), optional `tags`.
2. Commit and push to `main` (or edit the file directly on github.com → Commit).
3. Cloudflare Pages rebuilds and deploys automatically (~1 min).

## Build settings (Cloudflare Pages)
- Build command: `npm run build`
- Output directory: `dist`

## After buying the custom domain
Update `site` in `astro.config.mjs` to the final domain (fixes sitemap/RSS URLs).

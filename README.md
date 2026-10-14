# AgenQuest website and AI visibility audit

Astro 5 static website with Cloudflare Pages Functions. GitHub `main` is the production source; Cloudflare builds with `npm run build` and serves `dist`.

## Development and verification

Use a normal local checkout. Do not use the old mounted checkout’s Git metadata or its legacy `public/index.html`.

```
npm ci
npm test
npm run build
npm run dev
```

The Astro development server serves static pages; running Pages Functions locally also requires Cloudflare’s local runtime. Tests exercise the function handlers with controlled provider responses and never send emails or make paid AI calls.

## Audit behavior

- `/api/suggest` requires completed, cited web research before proposing eight questions. It returns six discovery questions and two branded validation questions. Low-confidence research is rejected.
- `/api/audit` accepts exactly one question per request. The browser runs two concurrently, preserves verified answers and retries only failures.
- Every accepted answer requires a completed Responses web-search call, completed assistant output and usable citation URLs. Plain completions and synthetic fallbacks are never substituted.
- Search has a 35-second deadline; classification has a 15-second deadline. Browser requests stop after 55 seconds. Provider body parsing is included in each deadline.
- An incomplete panel has no score and cannot be emailed as a complete report. Branded questions are excluded from the deterministic discovery score.
- `/api/lead` confirms success only after Resend accepts the report. It includes observed answers, cited links, model and timestamps in the email. Provider acceptance is not confirmation of inbox delivery. Idempotency keys protect report-email retries from duplicates.

## Configuration

Production secrets: `OPENAI_API_KEY`, `RESEND_API_KEY`. Optional contact storage uses the existing `RESEND_AUDIENCE_ID`. Preview deployments need their own configuration for live checks; without it the API returns a clear 503.

Optional model settings: `OPENAI_SEARCH_MODEL` (default `gpt-4.1-mini`) and `OPENAI_TEXT_MODEL` (default `gpt-4o-mini`). The search model must support Responses `web_search`. These defaults are supported as of 14 October 2026 but scheduled to retire on 14 January 2027; validate a replacement before that date. Changing the configured model does not enable fallback behavior.

Never commit credentials. `.dev.vars` and environment files are ignored. Manage production secrets through the provider dashboards and Cloudflare's encrypted configuration.

## Diagnostics

Structured logs include an application request ID, stage, elapsed time, upstream HTTP status and provider request ID when available. They omit prompts, answers, keys and contact details. Errors return a reference ID to the visitor. Distinguish gateway HTTP errors from Cloudflare invocation statuses.

## Content

Posts live in `src/blog` with `title`, `description`, `date`, optional `tags`, and optional `draft`. Index, post routes and RSS exclude drafts. Manual consumer ChatGPT research panels and the free single-run API audit are explained separately at `/research-methodology/`.

Articles use the AgenQuest organization as their author.

## Deployment checks and IndexNow

Pull requests run the audit tests and production build. Each Pages build writes a public `deployment.json` containing only the commit SHA and build time, with caching disabled.

The IndexNow workflow runs after pushes to `main`. It waits until the production domain serves that exact commit, verifies the existing public site-verification file, reads the live sitemap, and submits its URLs. A stale or failed deployment causes the workflow to fail without submitting URLs. No OpenAI, Resend, Cloudflare or personal GitHub credentials are needed by these workflows.

An IndexNow acknowledgement confirms receipt, not crawling or indexing. The verification file is intentionally public and is distinct from private API credentials.

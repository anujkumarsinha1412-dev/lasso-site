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

## Consultation redesign preview (16 October 2026)

The redesign is based on production commit f2e68b1. It keeps all 18 published Markdown articles, existing paths and homepage anchor aliases. The public audit widget is retired; the audit API, its reliability fixes, analytics runtime, GTM configuration and reporting remain intact. Measurement changes and the new comparison article are excluded from this release.

New routes are /contact/, /how-we-help/ and /who-aeo-is-for/. Shared layout and navigation apply to every existing page. Guide pricing is edited once in src/data/consultancy.js. Founder portraits and LinkedIn buttons are omitted until genuine assets are provided; founders should verify the supplied biography copy before publication.

### Contact backend and release prerequisites

- Apply migrations/0002_consultation_inquiries.sql to the intended LEAD_DB before enabling the new form. This adds separate consultation tables and leaves the audit funnel untouched. Take the normal database backup before a production migration.
- Reuse the existing LEAD_DB and RESEND_API_KEY bindings. Consultation defaults are INQUIRY_FROM_EMAIL='Agenquest <hello@agenquest.com>', INQUIRY_OWNER_EMAIL='agenquest@gmail.com', and INQUIRY_REPLY_TO_EMAIL='hello@agenquest.com'. Acknowledgment replies go to hello; founder-notification replies go to the validated prospect address. Optional variables override the defaults. Verify the Resend sending domain and actual delivery and reply handling before launch.
- These defaults are in the source and require no new hosting variables. An optional Pages configuration update was rejected by automatic approval review over possible replacement of existing secret settings. The read API redacts secrets, so no full configuration rewrite was attempted; all live settings remain unchanged.
- On 16 October 2026, the signed-in Agenquest Resend dashboard showed agenquest.com as Verified and explicitly ready to send emails. Existing Cloudflare routing forwards hello@agenquest.com and audit@agenquest.com to the verified agenquest@gmail.com destination. No DNS change or additional sender-domain setup was needed. This verifies configuration, not delivery of the new consultation emails or a reply round-trip; those tests remain before launch.
- An inquiry and its two mail jobs commit together. A durable save is success; email acceptance is a separate outcome. No newsletter subscription or new analytics event is emitted.
- Mail jobs are attempted after submission. Pending jobs are also drained by /api/health through middleware. Retries are opportunistic, use provider idempotency and stop for owner review after 23 hours or eight failed attempts. Ensure the existing health monitor runs or establish a scheduled drain before relying on unattended retry delivery.
- The form enforces same-origin JSON requests, server validation, a honeypot, an hourly hashed-IP rate limit, and idempotent request references. It never fetches the supplied website. Its fields are explicitly masked in Clarity.
- Retention and inbox responsibility were approved on 16 October 2026: Anuj owns the Agenquest inbox, scheduling, and privacy requests, with Rishav as backup. No new account access was granted. No production migration, live test email or production deployment was performed for this preview.
- New pages carry canonical metadata. Branch previews and local development are noindex; the production main build is indexable. The local review server additionally supplies a noindex response header and a visible preview notice.

### Validation

Run npm test and npm run build. The consultation tests exercise actual SQLite migrations and include invalid data, duplicate/concurrent requests, transaction rollback, storage errors, rate limits, email failures and retries. The local review server stores only local preview inquiries and has no outbound email credentials. A real sender/recipient delivery test remains a launch check.

### Agreed retention policy and handling

- Unconverted inquiries: six calendar months from the last substantive conversation; use submission date if there is no subsequent conversation. Automated acknowledgments, routine outbound reminders, and unrelated site activity never reset the clock.
- Former automated audit reports and associated contact details: 90 days from creation. For an active consultation, preserve only relevant information as an inquiry or client record, not the whole expired audit by default. Published independent research is outside this cleanup.
- Necessary client records require their own engagement and recordkeeping schedule. Document any limited exception for an ongoing dispute or another necessary purpose, including its owner and review date.
- Apply the policy to database rows, queued email payloads, stored contact copies, founder mailbox messages, and any exports. Account for provider-controlled logs and backups separately. A restore must reapply completed deletions before returning restored records to use.
- Anuj handles requests sent to hello@agenquest.com; Rishav covers absence. Do not share account passwords or add access as part of a retention change. Human replies should use the verified hello identity once its mail-client sending configuration is confirmed.
- Launch prerequisite: inventory existing records and dates without exporting personal data unnecessarily, identify records due for deletion and any exceptions, and establish an operational review/cleanup process covering both the database and mailbox. Confirm provider retention settings and document any limits accurately.
- This preview records the approved policy but does not activate scheduled deletion or erase production data. Review any initial cleanup separately before execution. The consultation schema currently stores creation time and processing status; the operational process must record substantive-contact dates and client transitions before calculating later expiry dates.

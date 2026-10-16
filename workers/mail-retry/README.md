# Scheduled email retries

`agenquest-mail-retry` runs every minute on Cloudflare Cron, independently of browser traffic. It calls the existing Pages `/api/health` wake-up route, which awaits both durable mail queues. Pages retains its existing D1 binding and Resend secret; this Worker has neither. Pages does not expose a stable service-binding target in this project, so the scheduler uses the fixed production HTTPS URL, rejects redirects, and requires the expected JSON response. No customer data crosses this boundary.

The Worker is cron-only (`workers_dev` and preview URLs disabled; no routes). Its HTTP handler returns 404. The health route returns 503 for missing mail configuration or database errors. A 200 confirms both queue drains completed, **not** that all emails were delivered: provider errors remain saved with a future retry time. A missed/failed cron tick is picked up by the next minute's tick.

## Delivery behavior

- Both consultation emails (acknowledgment and founder notification) and legacy audit founder notifications are included. Audit report generation/sending itself is unchanged.
- Each tick processes up to two due jobs per queue. Stored backoff prevents a request every minute from hammering a failing provider.
- Atomic 60-second database leases prevent overlapping drains from claiming the same row. Abandoned leases can be recovered. Stable Resend idempotency keys protect retries after an uncertain response.
- Existing retry limits remain: eight unsuccessful attempts or the 23-hour safety window. Terminal failures remain in the database for owner review. Do not blindly reset them: check Resend acceptance first, because its idempotency protection expires after 24 hours.
- The scheduled HTTP request times out after 25 seconds. Existing provider calls time out after seven seconds (two sequential legacy jobs, two concurrent consultation jobs).

## Observe and troubleshoot

Cloudflare Workers & Pages → `agenquest-mail-retry` → Logs shows `mail_retry_tick` for every invocation. Failures throw after logging so they appear as failed cron events. Logs contain only timestamps and generic status codes.

The private KV namespace `agenquest-mail-retry-status` (`04d302dca5ec47a48a6ff79b783648f7`), key `latest`, records a checkpoint on five-minute boundaries (288 writes/day). It contains `scheduled_at`, `finished_at`, `ok`, and `code`. Allow for KV propagation; a checkpoint older than ten minutes needs investigation. This is operational status, not an automatic alert subscription.

For delivery failures, review state/attempt counts and next-attempt times in `consultation_mail` and `notification_outbox`. Accepted means Resend accepted the email; subsequent bounces and inbox placement require Resend delivery logs. After a temporary Pages, database or network outage, the next scheduled tick resumes due jobs automatically within the existing retry window.

## Deploy and rollback

The website deploys from `main` through the existing Pages integration. Deploy the health change first, verify `mail_retry: completed`, then deploy the scheduler. No Pages environment rewrite or schema migration is required.

With an authenticated Wrangler v4 installation:

```sh
wrangler types --config workers/mail-retry/wrangler.jsonc workers/mail-retry/worker-configuration.d.ts
wrangler deploy --dry-run --config workers/mail-retry/wrangler.jsonc
wrangler deploy --config workers/mail-retry/wrangler.jsonc
```

Regenerate types after configuration changes. The generated runtime declaration is ignored by Git. Keep schedule and bindings in `wrangler.jsonc` synchronized with production. Cron changes can take up to 15 minutes to propagate. Verify an actual scheduled event/checkpoint before considering deployment complete.

To stop scheduled sending, remove the cron expression from this Worker's configuration and deploy (or replace this Worker's schedule list with an empty list through the Cloudflare API). Existing stored jobs remain intact. To roll back code, restore the prior Worker version; do not revert unrelated website changes or edit Resend credentials.

References: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

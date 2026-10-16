# Scheduled email retries

`agenquest-mail-retry` runs every minute on Cloudflare Cron, independently of browser traffic. It calls the existing Pages `/api/health` wake-up route, which awaits both durable mail queues. Pages retains its Resend secret; this Worker has no Resend credentials. Pages does not expose a stable service-binding target in this project, so the scheduler uses the fixed production HTTPS URL, rejects redirects, and requires the expected JSON response. No customer data crosses that HTTP boundary.

The Worker also binds `LEAD_DB` to detect exhausted messages and persist alert state. Its SQL selects only references, message kind, test status, attempt counts and generic reasons, without reading the email payloads. The `FAILURE_EMAIL` binding sends warnings through Cloudflare directly to the already verified `agenquest@gmail.com` destination. Its fixed recipient restriction prevents sending alerts elsewhere. Cloudflare Email Routing is already enabled for agenquest.com; no Resend secret or new Pages environment variables are needed.

The Worker is cron-only (`workers_dev` and preview URLs disabled; no routes). Its HTTP handler returns 404. The health route returns 503 for missing mail configuration or database errors. A 200 confirms both queue drains completed, **not** that all emails were delivered: provider errors remain saved with a future retry time. A missed/failed cron tick is picked up by the next minute's tick.

## Delivery behavior

- Both consultation emails (acknowledgment and founder notification) and legacy audit founder notifications are included. Audit report generation/sending itself is unchanged.
- Each tick processes up to two due jobs per queue. Stored backoff prevents a request every minute from hammering a failing provider.
- Atomic 60-second database leases prevent overlapping drains from claiming the same row. Abandoned leases can be recovered. Stable Resend idempotency keys protect retries after an uncertain response.
- Existing retry limits remain: eight unsuccessful attempts or the 23-hour safety window. Terminal failures remain in the database for owner review. Do not blindly reset them: check Resend acceptance first, because its idempotency protection expires after 24 hours.
- The scheduled HTTP request times out after 25 seconds. Existing provider calls time out after seven seconds (two sequential legacy jobs, two concurrent consultation jobs).

## Exhausted-message alerts

After each drain, the Worker scans `failed` messages in both queues and inserts their metadata into `mail_failure_alerts` with a unique `(queue,message_id)` key. It does this even if the Pages request failed. Acknowledgments, inquiry founder notifications and legacy audit founder notifications are covered. Accepted/delivered messages and failures after provider acceptance (such as later bounces) are outside this alert's scope.

Alerts include the request/message reference, type, number of attempts and whether the retry count or safety window ended. They contain no visitor name, address, website, report or message text. Marked test requests produce `[TEST]` warnings. Review the original request and Resend logs before manually resending; a prior acceptance can be uncertain after a storage failure.

Up to two alerts are sent per tick. Five-minute atomic leases prevent ordinary overlapping sends; accepted alerts are not sent again. If Cloudflare rejects an alert, it remains pending with exponential backoff capped at one hour and resumes after recovery, without an automatic retry-count cutoff. Alerts do not depend on Resend. A Cloudflare/email/inbox outage can still delay them. There is no cross-service transaction or provider idempotency key: a crash after Cloudflare acceptance but before its database acknowledgment can cause a duplicate warning after the lease expires. The stable message reference identifies that duplicate.

This feature does not retry terminal customer messages again, alter their safety limits, delete any records, or enable automatic retention cleanup. Alert metadata has no automatic cleanup either. If a source message is manually resolved or removed, its unsent alert is skipped.

## Observe and troubleshoot

Cloudflare Workers & Pages → `agenquest-mail-retry` → Logs shows `mail_retry_tick` for every invocation. Failures throw after logging so they appear as failed cron events. Logs contain only timestamps and generic status codes.

The private KV namespace `agenquest-mail-retry-status` (`04d302dca5ec47a48a6ff79b783648f7`), key `latest`, records a checkpoint on five-minute boundaries (288 writes/day). It contains timestamps, overall `ok`, `drain_ok`, `alerts_ok`, and a generic `code`. Allow for KV propagation; a checkpoint older than ten minutes needs investigation. `mail_failure_alerts` logs show accepted/deferred counts; unexpected scan/storage failures make the cron event fail. These operational logs contain no customer payloads.

For delivery failures, review state/attempt counts and next-attempt times in `consultation_mail` and `notification_outbox`. Accepted means Resend accepted the email; subsequent bounces and inbox placement require Resend delivery logs. After a temporary Pages, database or network outage, the next scheduled tick resumes due jobs automatically within the existing retry window.

## Deploy and rollback

The website deploys from `main` through the existing Pages integration. The scheduler is deployed separately. Before deploying its failure-alert feature, apply the additive `migrations/0004_mail_failure_alerts.sql` to the existing production database. Do not reapply older migrations or rewrite Pages environment variables.

With an authenticated Wrangler v4 installation:

```sh
wrangler d1 execute agenquest-leads-production --remote --file migrations/0004_mail_failure_alerts.sql --config workers/mail-retry/wrangler.jsonc
wrangler types --config workers/mail-retry/wrangler.jsonc workers/mail-retry/worker-configuration.d.ts
wrangler deploy --dry-run --config workers/mail-retry/wrangler.jsonc
wrangler deploy --config workers/mail-retry/wrangler.jsonc
```

Regenerate types after configuration changes. The generated runtime declaration is ignored by Git. Keep schedule and bindings in `wrangler.jsonc` synchronized with production. Cron changes can take up to 15 minutes to propagate. Verify an actual scheduled event/checkpoint before considering deployment complete.

Run `npm ci --prefix workers/mail-retry` then `npm test --prefix workers/mail-retry` for the Miniflare/workerd runtime regression check (also run in CI). The Node test suite covers both SQLite queues, backoff, leases and delivery recovery. The runtime check catches platform differences such as Workers accepting only `manual`/`follow` redirects despite the broader standard types. Non-2xx responses, including redirects, are rejected without following them.

To stop all scheduled sending, remove the cron expression from this Worker's configuration and deploy (or replace this Worker's schedule list with an empty list through the Cloudflare API). Existing stored jobs remain intact. To roll back only the alert feature, restore the prior Worker version: it continues the existing mail retry schedule without scanning alerts. Leave the additive metadata table in place. Do not revert unrelated website changes or edit Resend credentials.

References: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/), [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

# Email delivery and retry-timer monitoring

`agenquest-mail-monitor` is separate from `agenquest-mail-retry`. It receives signed Resend delivery events and runs its own five-minute cron. It sends operational warnings from hello@agenquest.com directly through Cloudflare's restricted email binding to agenquest@gmail.com, independently of Resend. It has no Resend API key and never initiates a customer resend.

## Delivery events

Configure one Resend webhook at `https://mail-monitor.agenquest.com/webhooks/resend` for `email.bounced`, `email.complained`, `email.failed` and `email.suppressed`. These are account-level events, so manual replies sent through the same Resend account are covered too. Opens, clicks and successful deliveries are not collected by this monitor.

Store the endpoint signing secret only as the Worker's `RESEND_WEBHOOK_SECRET` secret. Verification uses the raw bounded UTF-8 request body, Svix HMAC-SHA256, constant-time Web Crypto signature verification, and a five-minute timestamp tolerance. Missing/invalid signatures are rejected. Schema/storage errors return non-2xx so Resend retries. An HTTP 202 means warning metadata was durably saved, not that its email reached the inbox.

Only the opaque email ID, event type, timestamps, test flag and alert-delivery state are stored. Recipient addresses, message content, subjects and provider diagnostic strings are not copied into the table or logs. `[TEST]`-prefixed sends and recognized marked test records produce labelled warnings. The message ID/event pair deduplicates provider retries and replays. Duplicate warning email is still possible after provider acceptance if storing acceptance fails; there is no distributed exactly-once guarantee.

Alerts are attempted after capture and retried by the independent timer. Atomic five-minute leases prevent overlapping sends; delays increase up to one hour without an automatic retry-count cutoff. A bounce or complaint does not reset an accepted source job or trigger another customer email. Review the referenced message in Resend and confirm the right follow-up manually.

## Retry-timer watchdog

Each monitor tick reads the existing private KV checkpoint `latest`. It does not call `/api/health` or write the heartbeat, so website traffic cannot make a stopped retry timer look healthy. The checkpoint must be valid, no more than fifteen minutes old, and show `ok`, `drain_ok` and `alerts_ok` all true. Missing, invalid, future or unreadable checkpoints also warn. With a five-minute monitoring interval, a stopped timer is normally detected after approximately fifteen to twenty minutes, subject to platform scheduling and KV propagation.

One warning is queued per incident, followed by one recovery notice after a fresh healthy checkpoint returns. Recovery delivery waits for warning acceptance, so a temporary email outage cannot reverse their order. Incident state and pending alerts survive deployments.

The watcher runs on a different Worker and cron from the retry timer, but both use Cloudflare infrastructure and the existing D1/KV account. A platform-wide Cloudflare or database outage can delay the monitor too. It is not an externally hosted uptime service; independent provider-wide outage notification would require an additional outside monitor.

## Deploy and verify

Apply only the additive `migrations/0005_mail_monitor.sql` to the existing production D1 database before deploying this Worker. Keep the existing retry Worker, queue schema, Pages secrets and domain routing intact. Generate types, type-check, build, and deploy with the local Wrangler v4 configuration. Then store the Resend signing secret, configure the custom domain and webhook, and verify an actual signed event and scheduled healthy check.

Run `npm test` at the repository root, then `npm test --prefix workers/mail-retry` for both real Workers runtime checks. The monitor runtime test simulates the Cloudflare email binding locally; it never sends a real email.

For a live watchdog test, use a temporary canary Worker with the same bundle, `STATUS_KEY` pointing to a separate test heartbeat key, `WATCHDOG_KEY` set to a unique test value, and `MONITOR_TEST_MODE=true`. Give only that canary a one-minute schedule. Verify a labelled stale-heartbeat warning and recovery, then remove its schedule. Never stop the production retry timer or overwrite its `latest` checkpoint for testing. The production config does not set these canary overrides.

The new tables hold operational metadata only. No records are deleted, expired or automatically cleaned up by this feature. **Automatic retention cleanup remains off.** Existing historical records and pending customer mail remain intact.

Observe `mail_monitor_tick` and `mail_monitor_alerts` in private Workers Logs, and `mail_monitor_alerts`/`mail_watchdog_state` through authenticated D1 access. Logs omit email payloads and signing secrets. To roll back, disable this Worker's cron and the Resend webhook; leave the additive tables and original retry Worker intact.

Sources: [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests), [Svix verification format](https://docs.svix.com/receiving/verifying-payloads/how-manual), [Resend event reference](https://resend.com/docs/webhooks/emails/bounced), [Cloudflare email binding](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).

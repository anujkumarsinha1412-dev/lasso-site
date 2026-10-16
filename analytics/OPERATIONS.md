# Agenquest analytics operations

Current status: the audit funnel below is historical. Its public `/api/suggest`, `/api/audit` and `/api/lead` routes now return 410 without running the audit or sending a report. Preserve historical lead records, reports and analytics; do not use a complete public audit as a release check. Current inquiries use `/contact/` and `/api/inquiry`. The existing one-minute scheduler and failure alerts are documented in [the mail retry runbook](../workers/mail-retry/README.md). Automatic retention cleanup remains off.

Production: `agenquest.com` and `www.agenquest.com`. GTM `GTM-5RDHZMWP`, GA4 `G-DD18JLWTDD`, Clarity `yyh6q0ibct`. GA4 property 552715361; GSC domain `agenquest.com`.

## Collection and consent

GTM is the sole Google collection owner. It loads only after analytics consent on production hosts. The Google tag sends one initial page view; the event tag accepts only the exact approved event names. Automatic form, contact, outbound, history and scroll collection is disabled in the GTM destination settings. All advertising consent stays denied. Clarity uses analytics consent granted and ad consent denied. Its audit element mask is also configured in the project settings.

Never add email addresses, phone numbers, brands, report text or individual customer names to analytics parameters or UTM labels. Use shared campaign labels such as `linkedin / social / october-audit`.

`/?noanalytics=1` persistently excludes a browser. `/?noanalytics=0` removes that exclusion, but analytics still needs consent. Repeat per browser. Cloudflare edge request statistics are separate and include automated traffic. Local and Pages preview hosts do not load Google or Clarity. Local-only `?aq_qa=1` renders safe event diagnostics without sending them to providers.

The private lead ledger receives only service data needed to fulfil the audit. Source history is attached only when analytics was consented. Missing source data means unknown, not a guessed source.

## Durable lead records

Cloudflare D1 `agenquest-leads-production` is bound as `LEAD_DB`. Preview uses a separate `agenquest-leads-preview` database. Schema: `migrations/0001_leads.sql`. No public lead-list or admin endpoint exists; use the authenticated Cloudflare D1 console.

`leads` distinguishes pending/failed/accepted/delivered/bounced report email from qualification, booked calls, held calls and won/lost outcomes. `accepted` proves provider acceptance only. Delivery fields must be updated only from actual provider evidence. `lead_events` records submission/acceptance history. Repeated submission of the same email and report reuses one lead ID and does not send a second accepted report.

An authenticated owner can mark a test by adding a `test_submission` entry to `lead_events`. `lead_funnel_daily` excludes those records while preserving the complete test evidence. The 16 October launch test is marked this way; its one report was independently verified in the receiving Gmail inbox. Browser QA visits use `qa / internal / tracking-launch`; exclude that source in business reports. The GA4 numeric score parameter is `audit_score`, leaving the historical `score` dimension intact. The saved ten-step exploration is `Agenquest — audit enquiry funnel`.

`notification_outbox` keeps failed owner alerts. Due alerts retry on document visits and `/api/health`, with leases, exponential backoff and stable idempotency keys. Eight failures, or a retry outside the safe provider window, require owner review. These historical jobs also retry on the existing one-minute scheduled drain; see the mail retry runbook. Check failed or old pending rows when reviewing leads:

```sql
SELECT id,lead_id,state,attempts,next_attempt_at,last_error
FROM notification_outbox WHERE state <> 'accepted' ORDER BY next_attempt_at;
SELECT * FROM lead_funnel_daily ORDER BY day DESC;
```

Historical queued owner notifications retain their saved recipient and payload. No new audit reports, lead records or contact sync are initiated through the retired public routes. Current consultation notifications use the separate inquiry email configuration.

## Confirmed later outcomes

No booking provider or public phone number has been supplied. Do not infer a booking from a click, or qualification from a report request. The private ledger already has the fields needed to record confirmed outcomes. Use a parameterized update through an authenticated database client, for example:

```sql
UPDATE leads SET qualified_at=?,updated_at=? WHERE id=? AND qualified_at IS NULL;
UPDATE leads SET call_booked_at=?,updated_at=? WHERE id=? AND call_booked_at IS NULL;
UPDATE leads SET call_held_at=?,updated_at=? WHERE id=? AND call_held_at IS NULL;
UPDATE leads SET outcome=?,outcome_at=?,outcome_reason=?,value_gbp=?,updated_at=? WHERE id=?;
```

Future CRM/scheduler integration should record these transitions once and emit `qualify_lead`, `call_booked`, `call_held`, `close_convert_lead` or `close_unconvert_lead` only from confirmed records, with consent and deduplication. No fabricated offline conversions or browser-side measurement secrets are used.

## Funnel interpretation

Use the ordered events `page_view → cta_click → audit_started → audit_prompts_generated → audit_run → audit_completed → lead_gate_view → lead_form_start → lead_submit_attempt → generate_lead`. A visitor may begin directly at the audit, so compare both open and closed funnels. Segment by session source/medium/campaign, landing page, device, AI source, page group, CTA placement and bounded category group. Inspect `audit_partial`, retries, validation errors and `audit_failed` separately.

The browser funnel is consented activity. The private ledger is the service submission record, including submissions without analytics consent. Counts will differ. GSC clicks and impressions are aggregate search data and cannot identify which individual visitor converted. Session recordings are sampled and masked, not a complete history of every visitor.

## Temporary audit gateway failures

Research and question checks retry once after a short delay for gateway HTML (502/503/504), interrupted connections, request/provider timeouts and explicitly coded transient upstream failures. A provider cooldown over five seconds requires a later manual retry. Lead submissions, invalid evidence, uncertain brands and configuration errors never auto retry. Each panel still has at most two active requests; verified answers are retained, and exhausted failures keep the score pending. The existing `is_retry` completion parameter includes automatic recovery.

The 16 October investigation reproduced a 7/8 panel; retrying its one failed question returned cited evidence and completed 8/8. A temporary production trace showed the successful retry with both provider calls returning 200, no runtime exception and a 4.7-second duration. This confirms transient recovery, not the permanent elimination of every upstream outage. The temporary trace was removed after use. The receiving-inbox evidence for the earlier single email test remains valid; no additional report was sent during this investigation.

Cloudflare's native Web Analytics dashboard was verified with bot-excluded visits, page views and real-user LCP/INP/CLS data for agenquest.com. Browser replay verification in Clarity must use an actual available recording; a loaded script or live-user badge alone is insufficient proof.

## Release and rollback

Publish the reviewed GTM version, then deploy the code that removes direct gtag loading. The previous site does not load this GTM container. Do not reinstall a second direct Google or Clarity snippet. Keep the imported container JSON with this release.

For rollback, revert the website commit and restore GTM published version 1 (Empty Container) as a coordinated operation. Keep D1 lead data; schema changes are additive. Check the served `/deployment.json` SHA, `/api/health`, consent rejection/acceptance, preview exclusion and safe consultation validation plus the retired routes returning 410. Use an authorized consultation test only when a new delivery check is needed. Never send repeated live test reports to third-party prospects.

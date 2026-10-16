PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  email TEXT NOT NULL,
  brand TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  attribution_json TEXT,
  analytics_consent INTEGER NOT NULL DEFAULT 0 CHECK (analytics_consent IN (0,1)),
  discovery_score INTEGER,
  checked_count INTEGER NOT NULL,
  report_email_status TEXT NOT NULL DEFAULT 'pending' CHECK (report_email_status IN ('pending','failed','accepted','delivered','bounced')),
  report_email_id TEXT,
  report_email_accepted_at TEXT,
  contact_stored INTEGER NOT NULL DEFAULT 0,
  notification_status TEXT NOT NULL DEFAULT 'pending',
  qualified_at TEXT,
  call_booked_at TEXT,
  call_held_at TEXT,
  outcome TEXT CHECK (outcome IN ('won','lost') OR outcome IS NULL),
  outcome_at TEXT,
  outcome_reason TEXT,
  value_gbp REAL
);
CREATE TABLE IF NOT EXISTS lead_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  event TEXT NOT NULL,
  created_at TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id),
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','accepted','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  provider_id TEXT
);
CREATE INDEX IF NOT EXISTS lead_events_lead ON lead_events(lead_id, created_at);
CREATE INDEX IF NOT EXISTS outbox_due ON notification_outbox(state, next_attempt_at);
CREATE VIEW IF NOT EXISTS lead_funnel_daily AS
SELECT substr(created_at,1,10) AS day,
  count(*) AS submissions,
  sum(report_email_accepted_at IS NOT NULL) AS reports_accepted,
  sum(report_email_status='delivered') AS reports_delivered,
  sum(qualified_at IS NOT NULL) AS qualified,
  sum(call_booked_at IS NOT NULL) AS calls_booked,
  sum(call_held_at IS NOT NULL) AS calls_held,
  sum(outcome='won') AS won,
  sum(outcome='lost') AS lost,
  sum(CASE WHEN outcome='won' THEN coalesce(value_gbp,0) ELSE 0 END) AS won_value_gbp
FROM leads GROUP BY substr(created_at,1,10);

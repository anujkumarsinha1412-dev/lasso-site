-- Add operational metadata only. No record deletion or retention schedule.
CREATE TABLE IF NOT EXISTS mail_monitor_alerts (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('delivery','timer_stale','timer_recovered')),
 reason TEXT NOT NULL,
 reference TEXT NOT NULL,
 test_record INTEGER NOT NULL DEFAULT 0 CHECK(test_record IN (0,1)),
 created_at TEXT NOT NULL,
 depends_on TEXT,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL,
 lease_token TEXT,
 accepted_at TEXT,
 provider_id TEXT,
 last_error TEXT
);
CREATE INDEX IF NOT EXISTS mail_monitor_alerts_due ON mail_monitor_alerts(state,next_attempt_at);
CREATE TABLE IF NOT EXISTS mail_watchdog_state (
 id TEXT PRIMARY KEY,
 incident_id TEXT,
 opened_at TEXT
);

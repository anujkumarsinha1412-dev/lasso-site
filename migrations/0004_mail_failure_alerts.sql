-- Operational alert state only. No contact payloads are copied or deleted.
CREATE TABLE IF NOT EXISTS mail_failure_alerts (
 queue TEXT NOT NULL CHECK(queue IN ('consultation_mail','notification_outbox')),
 message_id TEXT NOT NULL,
 record_id TEXT NOT NULL,
 message_kind TEXT NOT NULL,
 test_record INTEGER NOT NULL DEFAULT 0 CHECK(test_record IN (0,1)),
 mail_attempts INTEGER NOT NULL,
 reason TEXT NOT NULL,
 first_seen_at TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL,
 lease_token TEXT,
 accepted_at TEXT,
 provider_id TEXT,
 last_error TEXT,
 PRIMARY KEY(queue,message_id)
);
CREATE INDEX IF NOT EXISTS mail_failure_alerts_due ON mail_failure_alerts(state,next_attempt_at);

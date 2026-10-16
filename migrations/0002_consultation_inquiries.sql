-- Separate from audit leads: this release does not change measurement or reporting.
CREATE TABLE IF NOT EXISTS consultation_inquiries (
 id TEXT PRIMARY KEY,
 request_key TEXT NOT NULL UNIQUE,
 payload_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 website TEXT NOT NULL,
 name TEXT NOT NULL,
 email TEXT NOT NULL,
 message TEXT NOT NULL DEFAULT '',
 source_page TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'new'
);
CREATE TABLE IF NOT EXISTS consultation_mail (
 id TEXT PRIMARY KEY,
 inquiry_id TEXT NOT NULL REFERENCES consultation_inquiries(id),
 payload_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL,
 next_attempt_at TEXT NOT NULL,
 provider_id TEXT,
 last_error TEXT
);
CREATE INDEX IF NOT EXISTS consultation_mail_due ON consultation_mail(state,next_attempt_at);
CREATE TABLE IF NOT EXISTS inquiry_rate_limits (
 bucket TEXT PRIMARY KEY,
 hits INTEGER NOT NULL DEFAULT 1,
 expires_at INTEGER NOT NULL
);

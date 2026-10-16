-- Measurement metadata stays separate from personal inquiry details.
CREATE TABLE IF NOT EXISTS consultation_attribution (
 inquiry_id TEXT PRIMARY KEY REFERENCES consultation_inquiries(id),
 analytics_consent INTEGER NOT NULL DEFAULT 0 CHECK(analytics_consent IN (0,1)),
 attribution_json TEXT
);

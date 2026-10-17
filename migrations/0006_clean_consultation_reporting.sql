-- A reporting view only: preserve all original enquiries and delivery evidence.
CREATE VIEW IF NOT EXISTS consultation_business_daily AS
SELECT substr(created_at,1,10) AS day,
  count(*) AS non_test_enquiries,
  sum(CASE WHEN status='new' THEN 1 ELSE 0 END) AS awaiting_review,
  sum(CASE WHEN status IN ('genuine','qualified','call_booked','customer') THEN 1 ELSE 0 END) AS verified_genuine
FROM consultation_inquiries
WHERE lower(trim(status)) NOT IN ('test','internal','spam','bot')
GROUP BY substr(created_at,1,10);

-- Record the 2026-09-01 Newrez $2,265.37 ACH (conf 104800282, loan …8062)
-- as August 2026. Do not set last_paid_at in September — due_day is 1, so a
-- Sep 1 timestamp makes the owner checklist look like September is paid.
--
-- last_paid_at is rewritten only when it looks like that Sep 1 posting:
--   null (never marked) or last_paid_at on 2026-09-01 America/New_York.
-- Never write last_paid_at backward from a later date. The Sep 1
-- window is closed at Sep 2; other timestamps are not rewritten.
-- Confirmation note is additive and does not touch last_paid_at.
-- Idempotent. Apply path: npm run db:migrate (Railway preDeploy).

UPDATE owner_payment_checklist
SET
  last_paid_at = TIMESTAMPTZ '2026-08-31 12:00:00-04',
  updated_at = NOW()
WHERE category = 'mortgage'
  AND (
    last_paid_at IS NULL
    OR (
      last_paid_at >= TIMESTAMPTZ '2026-09-01 00:00:00-04'
      AND last_paid_at <  TIMESTAMPTZ '2026-09-02 00:00:00-04'
    )
  );

UPDATE owner_payment_checklist
SET
  notes = CASE
    WHEN coalesce(notes, '') LIKE '%104800282%' THEN notes
    ELSE trim(both from
      coalesce(notes, '')
      || CASE WHEN coalesce(notes, '') = '' THEN '' ELSE E'\n\n' END
      || 'Newrez posted $2,265.37 on 2026-09-01 (conf 104800282, loan ending 8062) covering August 2026 — not September.'
    )
  END,
  updated_at = NOW()
WHERE category = 'mortgage'
  AND coalesce(notes, '') NOT LIKE '%104800282%';

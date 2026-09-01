-- Record the 2026-09-01 Newrez $2,265.37 ACH (conf 104800282, loan …8062)
-- as August 2026. Do not set last_paid_at in September — due_day is 1, so a
-- Sep 1 timestamp makes the owner checklist look like September is paid.
--
-- Idempotent: re-run keeps last_paid_at on Aug 31 noon ET and does not
-- duplicate the confirmation note. Apply path: npm run db:migrate

UPDATE owner_payment_checklist
SET
  last_paid_at = TIMESTAMPTZ '2026-08-31 12:00:00-04',
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
  AND (
    last_paid_at IS NULL
    OR last_paid_at >= TIMESTAMPTZ '2026-09-01 00:00:00-04'
    OR last_paid_at IS DISTINCT FROM TIMESTAMPTZ '2026-08-31 12:00:00-04'
    OR coalesce(notes, '') NOT LIKE '%104800282%'
  );

-- Never leave a September last_paid_at on the Newrez mortgage row.
UPDATE owner_payment_checklist
SET
  last_paid_at = TIMESTAMPTZ '2026-08-31 12:00:00-04',
  updated_at = NOW()
WHERE category = 'mortgage'
  AND last_paid_at >= TIMESTAMPTZ '2026-09-01 00:00:00-04'
  AND last_paid_at < TIMESTAMPTZ '2026-10-01 00:00:00-04';

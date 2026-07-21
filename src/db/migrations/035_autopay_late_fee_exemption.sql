-- Autopay tenants: skip rent late fees while automatic payments stay enabled.

CREATE OR REPLACE FUNCTION calculate_and_insert_late_fees()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    rec      RECORD;
    fee_amt  NUMERIC(10,2);
    inserted INTEGER := 0;
BEGIN
    FOR rec IN
        SELECT
            p.id                        AS payment_id,
            p.lease_id,
            p.amount                    AS rent_amount,
            p.due_date,
            l.late_fee_type,
            l.late_fee_amount,
            l.late_fee_cap,
            l.grace_period_days,
            (CURRENT_DATE - p.due_date) AS days_overdue
        FROM  payments p
        JOIN  leases   l ON l.id = p.lease_id
        WHERE p.payment_type = 'rent'
          AND p.status        = 'pending'
          AND p.due_date      IS NOT NULL
          AND (CURRENT_DATE - p.due_date) > l.grace_period_days
          AND l.autopay_enabled IS NOT TRUE
          AND NOT EXISTS (SELECT 1 FROM late_fees lf WHERE lf.payment_id = p.id)
    LOOP
        IF rec.late_fee_type = 'flat' THEN
            fee_amt := rec.late_fee_amount;
        ELSE
            fee_amt := ROUND(rec.rent_amount * rec.late_fee_amount / 100.0, 2);
            IF rec.late_fee_cap IS NOT NULL THEN
                fee_amt := LEAST(fee_amt, rec.late_fee_cap);
            END IF;
        END IF;

        INSERT INTO late_fees (lease_id, payment_id, amount, days_overdue, status, applied_at)
        VALUES (rec.lease_id, rec.payment_id, fee_amt, rec.days_overdue, 'applied', NOW());

        inserted := inserted + 1;
    END LOOP;

    RETURN inserted;
END;
$$;

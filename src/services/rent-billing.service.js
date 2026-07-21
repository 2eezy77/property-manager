/**
 * Monthly rent invoicing + late fee application + autopay.
 */
const pool = require('../db/client');
const { sendRentDueReminders, sendLateFeeAppliedNotifications } = require('./payment-email.service');
const { markLateFeesPaidForLease } = require('../utils/payment-settlement');
const { isElectricBillChargeable } = require('./dominion-billing.service');
const plaid = require('./plaid.service');
const stripe = require('./stripe.service');
const { decrypt } = require('../utils/encryption');
const { assertAchDebitAllowed } = require('./plaid-ach-guard.service');

function currentMonthStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10);
}

function currentMonthEnd(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);
}

async function generateMonthlyRentInvoices(db = pool) {
  const monthStart = currentMonthStart();
  const monthEnd = currentMonthEnd();

  const { rowCount } = await db.query(
    `INSERT INTO payments
       (lease_id, tenant_id, amount, currency, status, payment_type, period_start, period_end, due_date)
     SELECT l.id, l.tenant_id, l.monthly_rent, 'USD', 'pending', 'rent',
            $1::date, $2::date, $1::date
       FROM leases l
      WHERE l.status = 'active'
        AND l.start_date <= $2::date
        AND l.end_date >= $1::date
        AND NOT EXISTS (
          SELECT 1 FROM payments p
           WHERE p.lease_id = l.id
             AND p.payment_type = 'rent'
             AND p.period_start = $1::date
        )`,
    [monthStart, monthEnd]
  );
  return rowCount ?? 0;
}

async function applyLateFees(db = pool) {
  const since = new Date();
  const { rows } = await db.query(`SELECT calculate_and_insert_late_fees() AS inserted`);
  const inserted = Number(rows[0]?.inserted ?? 0);
  if (!inserted) return { inserted: 0, fees: [] };

  const { rows: fees } = await db.query(
    `SELECT lf.id AS late_fee_id, lf.amount, lf.days_overdue, lf.lease_id, lf.payment_id, l.tenant_id
       FROM late_fees lf
       JOIN leases l ON l.id = lf.lease_id
      WHERE lf.status = 'applied'
        AND lf.applied_at >= $1`,
    [since]
  );
  return { inserted, fees };
}

async function processAutopayCharges(db = pool) {
  const monthStart = currentMonthStart();
  const monthEnd = currentMonthEnd();
  let attempted = 0;
  let succeeded = 0;
  const errors = [];

  const { rows: leases } = await db.query(
    `SELECT l.id AS lease_id, l.tenant_id, l.monthly_rent,
            l.autopay_bank_account_id AS bank_account_id,
            ba.stripe_customer_id,             ba.plaid_access_token_encrypted, ba.plaid_account_id,
            ba.status AS bank_status, ba.link_status AS bank_link_status,
            u.first_name, u.last_name, u.email
       FROM leases l
       JOIN bank_accounts ba ON ba.id = l.autopay_bank_account_id AND ba.user_id = l.tenant_id
       JOIN users u ON u.id = l.tenant_id
      WHERE l.status = 'active'
        AND l.autopay_enabled = TRUE
        AND ba.status = 'verified'
        AND ba.link_status = 'active'`
  );

  for (const lease of leases) {
    const { rows: inFlight } = await db.query(
      `SELECT id FROM payments
        WHERE lease_id = $1 AND payment_type = 'rent'
          AND period_start = $2 AND status IN ('processing','succeeded')`,
      [lease.lease_id, monthStart]
    );
    if (inFlight.length) continue;

    const lateFeeAmount = await getLateFeeTotal(db, lease.lease_id);
    const rentAmount = parseFloat(lease.monthly_rent);
    const totalAmount = Math.round((rentAmount + lateFeeAmount) * 100) / 100;
    const amountCents = Math.round(totalAmount * 100);

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      attempted++;

      const { rows: pendingRows } = await client.query(
        `SELECT id FROM payments
          WHERE lease_id = $1 AND payment_type = 'rent' AND period_start = $2 AND status = 'pending'
          FOR UPDATE`,
        [lease.lease_id, monthStart]
      );

      let paymentId;
      const meta = { rent_amount: rentAmount.toFixed(2), late_fee_amount: lateFeeAmount.toFixed(2), autopay: true };
      if (pendingRows[0]) {
        const { rows: [u] } = await client.query(
          `UPDATE payments SET amount = $1, bank_account_id = $2, metadata = $3, updated_at = NOW()
            WHERE id = $4 RETURNING id`,
          [totalAmount, lease.bank_account_id, JSON.stringify(meta), pendingRows[0].id]
        );
        paymentId = u.id;
      } else {
        const { rows: [ins] } = await client.query(
          `INSERT INTO payments
             (lease_id, tenant_id, bank_account_id, amount, currency, status, payment_type,
              period_start, period_end, due_date, metadata)
           VALUES ($1,$2,$3,$4,'USD','pending','rent',$5,$6,$5,$7)
           RETURNING id`,
          [lease.lease_id, lease.tenant_id, lease.bank_account_id, totalAmount, monthStart, monthEnd, JSON.stringify(meta)]
        );
        paymentId = ins.id;
      }

      const accessToken = decrypt(lease.plaid_access_token_encrypted);

      const guard = await assertAchDebitAllowed({
        accessToken,
        accountId: lease.plaid_account_id,
        amountCents,
        userId: lease.tenant_id,
        userPresent: false,
        clientTransactionId: `autopay-${paymentId}`,
        context: 'autopay_rent',
      });
      if (!guard.ok) {
        await client.query('ROLLBACK');
        errors.push({ lease_id: lease.lease_id, error: guard.body.error, message: guard.body.message });
        continue;
      }

      const { routing, account: acctNum } = await plaid.getAchAccountNumbers(
        accessToken, lease.plaid_account_id
      );
      const holderName = [lease.first_name, lease.last_name].filter(Boolean).join(' ') || lease.email;
      const monthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

      const paymentIntent = await stripe.chargeACH({
        amountCents,
        customerId: lease.stripe_customer_id,
        routingNumber: routing,
        accountNumber: acctNum,
        accountHolderName: holderName,
        description: lateFeeAmount > 0 ? `Autopay rent + late fees — ${monthLabel}` : `Autopay rent — ${monthLabel}`,
        metadata: { payment_id: paymentId, lease_id: lease.lease_id, tenant_id: lease.tenant_id, autopay: 'true' },
        ipAddress: '',
        userAgent: 'autopay-service',
      });

      const localStatus =
        paymentIntent.status === 'succeeded' ? 'succeeded'
          : paymentIntent.status === 'canceled' ? 'failed'
            : 'processing';

      await client.query(
        `UPDATE payments
            SET stripe_payment_intent_id = $1,
                stripe_charge_id         = $2,
                status                   = $3::payment_status,
                paid_at = CASE WHEN $3::text = 'succeeded' THEN NOW() ELSE paid_at END,
                updated_at               = NOW()
          WHERE id = $4`,
        [
          paymentIntent.id,
          typeof paymentIntent.latest_charge === 'string'
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge?.id ?? null,
          localStatus,
          paymentId,
        ]
      );

      if (localStatus === 'succeeded' && lateFeeAmount > 0) {
        await markLateFeesPaidForLease(client, lease.lease_id);
      }

      await client.query('COMMIT');
      succeeded++;
    } catch (err) {
      await client.query('ROLLBACK');
      errors.push({ lease_id: lease.lease_id, error: err.message });
      console.error(`[autopay] lease ${lease.lease_id}:`, err.message);
    } finally {
      client.release();
    }
  }

  return { attempted, succeeded, errors };
}

async function chargeUtilitySplitAutopay(db, split) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const amountDollars = parseFloat(split.amount);
    const amountCents = Math.round(amountDollars * 100);

    const { rows: [payment] } = await client.query(
      `INSERT INTO payments
         (lease_id, tenant_id, bank_account_id, amount, currency,
          status, payment_type, due_date, metadata)
       VALUES ($1,$2,$3,$4,'USD','pending','utility',$5,$6)
       RETURNING id`,
      [
        split.lease_id,
        split.tenant_id,
        split.bank_account_id,
        amountDollars,
        split.due_date,
        JSON.stringify({ autopay: true, utility_split_id: split.split_id, utility_bill_id: split.bill_id }),
      ]
    );

    const accessToken = decrypt(split.plaid_access_token_encrypted);

    const guard = await assertAchDebitAllowed({
      accessToken,
      accountId: split.plaid_account_id,
      amountCents,
      userId: split.tenant_id,
      userPresent: false,
      clientTransactionId: `utility-autopay-${split.split_id}`,
      context: 'autopay_utility',
    });
    if (!guard.ok) {
      await client.query('ROLLBACK');
      const err = new Error(guard.body.message);
      err.code = guard.body.error;
      throw err;
    }

    const { routing, account: acctNum } = await plaid.getAchAccountNumbers(
      accessToken, split.plaid_account_id
    );
    const holderName = [split.first_name, split.last_name].filter(Boolean).join(' ')
      || split.email;

    const pi = await stripe.chargeACH({
      amountCents,
      customerId: split.stripe_customer_id,
      routingNumber: routing,
      accountNumber: acctNum,
      accountHolderName: holderName,
      description: `Autopay utility (${split.service_type}) — ${split.period_start} to ${split.period_end}`,
      metadata: {
        payment_id: payment.id,
        utility_bill_id: split.bill_id,
        utility_split_id: split.split_id,
        lease_id: split.lease_id,
        tenant_id: split.tenant_id,
        autopay: 'true',
      },
      ipAddress: '',
      userAgent: 'utility-autopay-service',
    });

    const localStatus =
      pi.status === 'succeeded' ? 'succeeded'
        : pi.status === 'canceled' ? 'failed'
          : 'processing';

    await client.query(
      `UPDATE payments
          SET stripe_payment_intent_id = $1,
              stripe_charge_id = $2,
              status = $3::payment_status,
              paid_at = CASE WHEN $3::text = 'succeeded' THEN NOW() ELSE paid_at END,
              updated_at = NOW()
        WHERE id = $4`,
      [
        pi.id,
        typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null,
        localStatus,
        payment.id,
      ]
    );

    await client.query(
      `UPDATE utility_bill_splits
          SET payment_id = $1, status = 'charging', updated_at = NOW()
        WHERE id = $2`,
      [payment.id, split.split_id]
    );

    if (split.bill_status === 'notified') {
      await client.query(
        `UPDATE utility_bills SET status = 'charging', updated_at = NOW() WHERE id = $1`,
        [split.bill_id]
      );
    }

    await client.query('COMMIT');
    return { ok: true, paymentId: payment.id, status: localStatus };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function processUtilityAutopayCharges(db = pool) {
  const { rows: splits } = await db.query(
    `SELECT s.id AS split_id,
            s.bill_id,
            s.lease_id,
            s.tenant_id,
            s.amount,
            ub.service_type,
            ub.period_start,
            ub.period_end,
            ub.due_date,
            ub.dispute_deadline_at,
            ub.chargeable_after,
            ub.status AS bill_status,
            l.autopay_bank_account_id AS bank_account_id,
            ba.stripe_customer_id,
            ba.plaid_access_token_encrypted,
            ba.plaid_account_id,
            u.first_name,
            u.last_name,
            u.email
       FROM utility_bill_splits s
       JOIN utility_bills ub ON ub.id = s.bill_id
       JOIN leases l ON l.id = s.lease_id
       JOIN bank_accounts ba ON ba.id = l.autopay_bank_account_id AND ba.user_id = s.tenant_id
       JOIN users u ON u.id = s.tenant_id
      WHERE l.autopay_enabled = TRUE
        AND l.status = 'active'
        AND ba.status = 'verified'
        AND ba.link_status = 'active'
        AND s.status = 'notified'
        AND s.payment_id IS NULL
        AND ub.status IN ('notified', 'charging')
        AND (ub.dispute_deadline_at IS NULL OR ub.dispute_deadline_at <= NOW())`
  );

  let attempted = 0;
  let succeeded = 0;
  const errors = [];

  for (const split of splits) {
    if (split.service_type === 'electric') {
      const bill = {
        service_type: 'electric',
        period_end: split.period_end,
        chargeable_after: split.chargeable_after,
      };
      if (!isElectricBillChargeable(bill)) continue;
    }

    try {
      attempted++;
      const result = await chargeUtilitySplitAutopay(db, split);
      if (result.status === 'succeeded' || result.status === 'processing') succeeded++;
    } catch (err) {
      errors.push({ split_id: split.split_id, error: err.message });
      console.error(`[utility-autopay] split ${split.split_id}:`, err.message);
    }
  }

  return { attempted, succeeded, errors };
}

async function runDailyRentBilling() {
  const invoices = await generateMonthlyRentInvoices();
  const autopay = await processAutopayCharges().catch((err) => {
    console.error('[rent-billing] autopay:', err.message);
    return { attempted: 0, succeeded: 0, errors: [{ error: err.message }] };
  });
  const utilityAutopay = await processUtilityAutopayCharges().catch((err) => {
    console.error('[rent-billing] utility autopay:', err.message);
    return { attempted: 0, succeeded: 0, errors: [{ error: err.message }] };
  });
  const feeResult = await applyLateFees();
  const lateFeeEmails = await sendLateFeeAppliedNotifications(feeResult.fees).catch((err) => {
    console.error('[rent-billing] late fee emails:', err.message);
    return { sent: 0, error: err.message };
  });
  const reminders = await sendRentDueReminders().catch((err) => {
    console.error('[rent-billing] reminder emails:', err.message);
    return { dueSent: 0, overdueSent: 0, error: err.message };
  });

  const summary = { invoices, fees: feeResult.inserted, lateFeeEmails, reminders, autopay, utilityAutopay };
  console.log(
    `[rent-billing] invoices=${invoices} late_fees=${feeResult.inserted} `
    + `fee_emails=${lateFeeEmails.sent ?? 0} due_emails=${reminders.dueSent ?? 0} `
    + `autopay=${autopay.succeeded}/${autopay.attempted} `
    + `utility_autopay=${utilityAutopay.succeeded}/${utilityAutopay.attempted}`
  );
  return summary;
}

async function getLateFeeTotal(db, leaseId) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM late_fees
      WHERE lease_id = $1 AND status IN ('pending', 'applied')`,
    [leaseId]
  );
  return parseFloat(rows[0]?.total ?? 0);
}

async function computeChargeBreakdown(db, leaseId) {
  const { rows: [lease] } = await db.query(
    `SELECT monthly_rent FROM leases WHERE id = $1`,
    [leaseId]
  );
  const rentAmount = parseFloat(lease?.monthly_rent ?? 0);
  const lateFeeAmount = await getLateFeeTotal(db, leaseId);
  return {
    rentAmount,
    lateFeeAmount,
    totalAmount: Math.round((rentAmount + lateFeeAmount) * 100) / 100,
  };
}

function scheduleDailyRentBilling() {
  const hour = Number(process.env.RENT_BILLING_HOUR ?? 8);

  const run = () => {
    runDailyRentBilling().catch((err) => console.error('[rent-billing]', err.message));
  };

  const msUntilNextRun = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  };

  setTimeout(() => {
    run();
    setInterval(run, 24 * 60 * 60 * 1000);
  }, msUntilNextRun());

  console.log(`[rent-billing] scheduled daily at ${hour}:00 local`);
}

module.exports = {
  currentMonthStart,
  currentMonthEnd,
  generateMonthlyRentInvoices,
  applyLateFees,
  runDailyRentBilling,
  getLateFeeTotal,
  computeChargeBreakdown,
  scheduleDailyRentBilling,
  processAutopayCharges,
  processUtilityAutopayCharges,
};

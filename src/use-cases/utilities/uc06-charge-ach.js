/** UC06 — Charge eligible splits via Stripe ACH. */

const pool = require('../../db/client');
const { isElectricBillChargeable } = require('../../services/dominion-billing.service');
const plaid = require('../../services/plaid.service');
const stripe = require('../../services/stripe.service');
const { decrypt } = require('../../utils/encryption');
const { assertAchDebitAllowed } = require('../../services/plaid-ach-guard.service');
const { accessiblePropertyIds } = require('./access');
const { fetchBillWithSplits } = require('./queries');
const { useCaseError } = require('./errors');

async function executeChargeBill({ userId, role, billId, force = false, ipAddress, userAgent }) {
  const propIds = await accessiblePropertyIds(userId, role);

  const { rows: [bill] } = await pool.query(
    `SELECT * FROM utility_bills WHERE id = $1`,
    [billId]
  );
  if (!bill || !propIds.includes(bill.property_id)) {
    throw useCaseError('NOT_FOUND', 'Bill not found.');
  }
  if (bill.status !== 'notified' && bill.status !== 'charging') {
    throw useCaseError('INVALID_STATE', `Bill is ${bill.status}; only notified bills can be charged.`);
  }
  if (!force && bill.dispute_deadline_at && new Date(bill.dispute_deadline_at) > new Date()) {
    throw useCaseError(
      'DEADLINE_NOT_REACHED',
      'Dispute deadline has not passed. Pass force=true to charge anyway.'
    );
  }

  if (!force && bill.service_type === 'electric' && !isElectricBillChargeable(bill)) {
    const after = bill.chargeable_after || bill.period_end;
    throw useCaseError(
      'BILLING_PERIOD_OPEN',
      `Electric bill billing period has not ended yet. Charge on or after ${after}, or pass force=true.`
    );
  }

  const { rows: eligible } = await pool.query(
    `SELECT s.id AS split_id,
            s.lease_id,
            s.tenant_id,
            s.amount,
            ba.id AS bank_account_id,
            ba.stripe_customer_id,
            ba.plaid_access_token_encrypted,
            ba.plaid_account_id,
            ba.link_status,
            u.first_name,
            u.last_name,
            u.email
       FROM utility_bill_splits s
       LEFT JOIN bank_accounts ba
              ON ba.user_id = s.tenant_id
             AND ba.is_default = TRUE
             AND ba.status = 'verified'
       JOIN users u ON u.id = s.tenant_id
      WHERE s.bill_id = $1
        AND s.status = 'notified'
        AND s.payment_id IS NULL`,
    [billId]
  );

  const charged = [];
  const skipped = [];

  if (bill.status === 'notified') {
    await pool.query(
      `UPDATE utility_bills SET status = 'charging', updated_at = NOW() WHERE id = $1`,
      [billId]
    );
  }

  for (const split of eligible) {
    if (!split.bank_account_id) {
      skipped.push({ split_id: split.split_id, reason: 'NO_VERIFIED_BANK' });
      continue;
    }
    if (split.link_status === 'needs_relink') {
      skipped.push({ split_id: split.split_id, reason: 'ACCOUNT_NEEDS_RELINK' });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const amountDollars = parseFloat(split.amount);
      const amountCents = Math.round(amountDollars * 100);

      const { rows: [payment] } = await client.query(
        `INSERT INTO payments
           (lease_id, tenant_id, bank_account_id, amount, currency,
            status, payment_type, due_date)
         VALUES ($1,$2,$3,$4,'USD','pending','utility',$5)
         RETURNING id`,
        [split.lease_id, split.tenant_id, split.bank_account_id, amountDollars, bill.due_date]
      );

      const accessToken = decrypt(split.plaid_access_token_encrypted);

      const guard = await assertAchDebitAllowed({
        accessToken,
        accountId: split.plaid_account_id,
        amountCents,
        userId: split.tenant_id,
        userPresent: false,
        clientTransactionId: `utility-${split.split_id}`,
        context: 'utility_split',
      });
      if (!guard.ok) {
        await client.query('ROLLBACK');
        skipped.push({
          split_id: split.split_id,
          reason: guard.body.error,
          detail: guard.body.message,
        });
        continue;
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
        description: `Utility (${bill.service_type}) — ${bill.period_start} to ${bill.period_end}`,
        metadata: {
          payment_id: payment.id,
          utility_bill_id: billId,
          utility_split_id: split.split_id,
          lease_id: split.lease_id,
          tenant_id: split.tenant_id,
        },
        ipAddress,
        userAgent,
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

      await client.query('COMMIT');
      charged.push({ split_id: split.split_id, payment_id: payment.id, amount: amountDollars });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[UC06 charge] split failed', split.split_id, err.message);
      skipped.push({ split_id: split.split_id, reason: 'STRIPE_FAILED', detail: err.message });
    } finally {
      client.release();
    }
  }

  const detail = await fetchBillWithSplits(pool, billId);
  return { charged, skipped, ...detail };
}

module.exports = { executeChargeBill };

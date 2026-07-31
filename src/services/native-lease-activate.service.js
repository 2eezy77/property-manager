async function activateNativeLeaseAfterDeposit(client, leaseId) {
  const { rows: [lease] } = await client.query(
    `SELECT id, status, signing_provider
       FROM leases
      WHERE id = $1
      FOR UPDATE`,
    [leaseId]
  );
  if (!lease || lease.signing_provider !== 'native') return null;
  if (!['awaiting_deposit', 'awaiting_identity'].includes(lease.status)) return null;

  const { rows: [identity] } = await client.query(
    `SELECT status
       FROM tenant_identity_verifications
      WHERE lease_id = $1`,
    [leaseId]
  );
  const verified = identity?.status === 'verified';

  if (!verified) {
    const { rows } = await client.query(
      `UPDATE leases
          SET status = 'awaiting_identity',
              deposit_paid_at = COALESCE(deposit_paid_at, NOW()),
              updated_at = NOW()
        WHERE id = $1
          AND signing_provider = 'native'
        RETURNING id, status`,
      [leaseId]
    );
    return rows[0] || null;
  }

  const { rows } = await client.query(
    `UPDATE leases
        SET status = 'active',
            deposit_paid_at = COALESCE(deposit_paid_at, NOW()),
            updated_at = NOW()
      WHERE id = $1
        AND signing_provider = 'native'
        AND status IN ('awaiting_deposit', 'awaiting_identity')
      RETURNING id, status`,
    [leaseId]
  );
  return rows[0] || null;
}

module.exports = { activateNativeLeaseAfterDeposit };

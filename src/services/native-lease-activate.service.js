async function activateNativeLeaseAfterDeposit(client, leaseId) {
  const { rows } = await client.query(
    `UPDATE leases
        SET status = 'active',
            deposit_paid_at = COALESCE(deposit_paid_at, NOW()),
            updated_at = NOW()
      WHERE id = $1
        AND signing_provider = 'native'
        AND status = 'awaiting_deposit'
      RETURNING id, status`,
    [leaseId]
  );
  return rows[0] || null;
}

module.exports = { activateNativeLeaseAfterDeposit };

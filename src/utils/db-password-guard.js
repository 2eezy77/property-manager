/**
 * Prevent accidental password resets on the shared production database.
 * Listing users is always allowed; mutations require an explicit opt-in.
 */

const TENANT_EMAILS_743 = new Set([
  'buckleystone1@gmail.com',
  'isaiahreese13@outlook.com',
  'davontayegara95@gmail.com',
]);

function passwordResetAllowed() {
  return process.env.ALLOW_DB_PASSWORD_RESET === '1'
    || process.env.ALLOW_DB_PASSWORD_RESET === 'true';
}

function assertPasswordResetAllowed({ targetEmail, argv = [] } = {}) {
  if (passwordResetAllowed()) return;

  const isTenant = targetEmail && TENANT_EMAILS_743.has(targetEmail.toLowerCase());
  const forceTenant = argv.includes('--allow-tenant-reset');

  if (isTenant && !forceTenant) {
    const err = new Error(
      'Refusing to reset a real tenant password on the shared database.\n'
      + '  • Test tenant UI: Owner dashboard → View as (no tenant password needed)\n'
      + '  • Override: ALLOW_DB_PASSWORD_RESET=1 node src/db/reset-password.js <email> <pw> --allow-tenant-reset\n'
      + '  • List accounts: npm run db:reset-password list'
    );
    err.code = 'TENANT_PASSWORD_PROTECTED';
    throw err;
  }
}

function assertBootstrapAllowed(argv = []) {
  if (passwordResetAllowed()) return;
  if (argv.includes('--allow-tenant-reset')) return;

  const err = new Error(
    'bootstrap-743 resets all accounts including tenants. Blocked on the shared database.\n'
    + '  • Staff only: npm run qa:bootstrap -- --apply\n'
    + '  • Full reset: ALLOW_DB_PASSWORD_RESET=1 node src/db/reset-password.js bootstrap-743 --allow-tenant-reset'
  );
  err.code = 'BOOTSTRAP_BLOCKED';
  throw err;
}

module.exports = {
  TENANT_EMAILS_743,
  passwordResetAllowed,
  assertPasswordResetAllowed,
  assertBootstrapAllowed,
};

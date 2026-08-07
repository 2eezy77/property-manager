/**
 * Former tenants removed from the live site but kept in DB / workspace archives.
 * When users.site_archived_at is set, they must not appear in UI list APIs
 * (Tenants, Leases, Payments filters, Inbox, Admin users, etc.).
 * Collections notices for archived people live under archive/collections/.
 */
function notSiteArchivedWhere(alias = 'u') {
  return `${alias}.site_archived_at IS NULL`;
}

function isSiteArchivedUser(user) {
  return Boolean(user?.site_archived_at);
}

module.exports = { notSiteArchivedWhere, isSiteArchivedUser };

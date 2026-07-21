const catalog = require('./catalog');
const { httpStatusForCode } = require('./errors');
const { executeCreateBill } = require('./uc01-create-bill');
const { executeNotifyTenants } = require('./uc03-notify-tenants');
const { executeDisputeShare } = require('./uc04-dispute-share');
const { executeWaiveShare, executeRejectDispute } = require('./uc05-resolve-dispute');
const { executeChargeBill } = require('./uc06-charge-ach');
const { maybeSettleBill } = require('./uc07-settle-bill');
const {
  executeGmailStatus,
  executeGmailConnect,
  executeGmailCallback,
  executeImportFromGmail,
} = require('./uc08-gmail');
const { listBills, getBillForStaff, getTenantSplits } = require('./queries');
const {
  executeDeleteDraftBill,
  executePruneDuplicateDrafts,
  executePruneStaleDrafts,
} = require('./uc-delete-draft-bill');
const { executeCombineMonthlyDrafts } = require('./uc10-combine-monthly');
const { enforceLatestCollectible } = require('./enforce-latest-collectible');
const { executeRecalculateSplits } = require('./uc-recalculate-splits');
const pool = require('../../db/client');
const { accessiblePropertyIds } = require('./access');

module.exports = {
  catalog,
  httpStatusForCode,
  executeCreateBill,
  executeNotifyTenants,
  executeDisputeShare,
  executeWaiveShare,
  executeRejectDispute,
  executeChargeBill,
  maybeSettleBill,
  executeGmailStatus,
  executeGmailConnect,
  executeGmailCallback,
  executeImportFromGmail,
  listBills,
  getBillForStaff,
  getTenantSplits,
  executeDeleteDraftBill,
  executePruneDuplicateDrafts,
  executePruneStaleDrafts,
  executeCombineMonthlyDrafts,
  executeRecalculateSplits,
  enforceLatestCollectible,
  async executeEnforceLatestCollectible({ userId, role, propertyId }) {
    const propIds = propertyId ? [propertyId] : await accessiblePropertyIds(userId, role);
    const client = await pool.connect();
    const summary = { groups: 0, settled_older: 0, splits_waived: 0, latest_reopened: 0 };
    try {
      for (const id of propIds) {
        const s = await enforceLatestCollectible(client, { propertyId: id });
        summary.groups += s.groups;
        summary.settled_older += s.settled_older;
        summary.splits_waived += s.splits_waived;
        summary.latest_reopened += s.latest_reopened;
      }
      return summary;
    } finally {
      client.release();
    }
  },
};

/**
 * Utility bill splitter — use case catalog.
 * Sommerville Ch. 4: actors, goals, pre/postconditions, system boundary.
 * Routes and UI reference these IDs; business logic lives in uc*.js modules.
 */

module.exports = {
  UC01: {
    id: 'UC01',
    name: 'Create utility bill',
    actor: 'Owner, Property Manager',
    goal: 'Record a bill and compute equal shares across active leases',
    preconditions: ['Actor can access the property', 'Leases overlap the bill period'],
    postconditions: ['Bill status is draft', 'One split row per active lease'],
    endpoint: 'POST /api/utilities/bills',
  },
  UC02: {
    id: 'UC02',
    name: 'Preview equal split',
    actor: 'Owner, Property Manager',
    goal: 'Review per-tenant amounts before notifying',
    preconditions: ['UC01 completed'],
    postconditions: ['Split amounts sum to bill total'],
    endpoint: 'GET /api/utilities/bills/:id',
  },
  UC03: {
    id: 'UC03',
    name: 'Notify tenants',
    actor: 'Owner, Property Manager',
    goal: 'Open the 48-hour dispute window and alert tenants',
    preconditions: ['Bill is draft'],
    postconditions: ['Bill status is notified', 'dispute_deadline_at set', 'In-app notifications sent'],
    endpoint: 'POST /api/utilities/bills/:id/notify',
  },
  UC04: {
    id: 'UC04',
    name: 'Dispute share',
    actor: 'Tenant',
    goal: 'Challenge an assigned share before the deadline',
    preconditions: ['Split is notified', 'Dispute window open'],
    postconditions: ['Split status is disputed', 'Reason stored'],
    endpoint: 'POST /api/utilities/splits/:id/dispute',
  },
  UC05: {
    id: 'UC05',
    name: 'Resolve dispute',
    actor: 'Owner, Property Manager',
    goal: 'Waive a share or reject a dispute and allow charging',
    preconditions: ['Actor can access the bill property'],
    postconditions: ['Split is waived or returned to notified', 'Bill may settle (UC07)'],
    endpoint: 'POST /api/utilities/splits/:id/waive | reject-dispute',
  },
  UC06: {
    id: 'UC06',
    name: 'Charge ACH',
    actor: 'Owner, Property Manager',
    goal: 'Debit non-disputed shares via Stripe ACH',
    preconditions: ['Bill is notified or charging', 'Tenant has verified bank account'],
    postconditions: ['Payment row created', 'Split status is charging'],
    endpoint: 'POST /api/utilities/bills/:id/charge',
  },
  UC07: {
    id: 'UC07',
    name: 'Settle bill',
    actor: 'System',
    goal: 'Close the bill when every split is terminal',
    preconditions: ['All splits paid, waived, or failed'],
    postconditions: ['Bill status is settled'],
    endpoint: 'Stripe webhook → maybeSettleBill',
  },
  UC08: {
    id: 'UC08',
    name: 'Connect org Gmail',
    actor: 'Owner, Super Admin',
    goal: 'Authorize read-only Gmail for utility e-bill import',
    preconditions: ['Google OAuth configured', 'Actor is owner or super_admin'],
    postconditions: ['Org refresh token stored', 'All staff see shared connection'],
    endpoint: 'GET /api/utilities/gmail/connect',
  },
  UC09: {
    id: 'UC09',
    name: 'Import bills from Gmail',
    actor: 'Owner, Property Manager',
    goal: 'Scan inbox and create draft bills (deduped by message id)',
    preconditions: ['UC08 completed', 'Property account numbers set when needed'],
    postconditions: ['Draft bills created', 'Duplicates skipped'],
    endpoint: 'POST /api/utilities/gmail/import',
  },
};

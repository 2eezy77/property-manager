/**
 * Detect Chime and Chime partner banks (Stride Bank, The Bancorp Bank).
 * Used only to explain bank ACH initiation failures — not Stripe card/Cash App declines.
 */

const CHIME_ACH_NOT_SUPPORTED = 'CHIME_ACH_NOT_SUPPORTED';
const ACH_INITIATION_FAILED = 'ACH_INITIATION_FAILED';

const CHIME_ACH_NOT_SUPPORTED_MESSAGE =
  "Chime doesn't allow bank ACH for rent. Pay with your Chime debit card instead.";

const ACH_INITIATION_FAILED_MESSAGE =
  'This bank payment could not be started. Try paying with a debit card instead.';

/** Official Chime partner ABA routing numbers (Chime help + known Stride variants). */
const CHIME_PARTNER_ROUTING_NUMBERS = new Set([
  '031101279', // The Bancorp Bank, N.A.
  '103100195', // Stride Bank, N.A. (current Chime listing)
  '124303120', // Stride Bank (also used for some Chime accounts)
]);

/** Known Plaid institution IDs for Chime (legacy / current Link records). */
const CHIME_PLAID_INSTITUTION_IDS = new Set([
  'ins_35',
]);

function normalizeRouting(routingNumber) {
  if (routingNumber == null) return '';
  return String(routingNumber).replace(/\D/g, '');
}

function normalizeInstitutionId(institutionId) {
  if (institutionId == null) return '';
  return String(institutionId).trim().toLowerCase();
}

function normalizeName(institutionName) {
  if (institutionName == null) return '';
  return String(institutionName).trim().toLowerCase();
}

function nameLooksLikeChimePartner(institutionName) {
  const name = normalizeName(institutionName);
  if (!name) return false;
  if (name.includes('chime')) return true;
  if (/\bstride\b/.test(name)) return true;
  if (name.includes('bancorpsouth') || name.includes('bancorp south')) return false;
  if (name.includes('the bancorp') || name.includes('bancorp bank')) return true;
  return false;
}

/**
 * @param {{ institutionName?: string|null, institutionId?: string|null, routingNumber?: string|null }} [bank]
 */
function isChimePartnerBank(bank = {}) {
  const routing = normalizeRouting(bank.routingNumber);
  if (routing && CHIME_PARTNER_ROUTING_NUMBERS.has(routing)) return true;

  const id = normalizeInstitutionId(bank.institutionId);
  if (id && CHIME_PLAID_INSTITUTION_IDS.has(id)) return true;

  return nameLooksLikeChimePartner(bank.institutionName);
}

/**
 * Tenant-facing body when ACH fails before a Stripe PaymentIntent exists.
 * Never claims Chime unless the linked bank looks like Chime / Stride / Bancorp.
 *
 * @param {{ institutionName?: string|null, institutionId?: string|null, routingNumber?: string|null }} [bank]
 */
function achInitiationFailure(bank = {}) {
  if (isChimePartnerBank(bank)) {
    return {
      error: CHIME_ACH_NOT_SUPPORTED,
      message: CHIME_ACH_NOT_SUPPORTED_MESSAGE,
    };
  }
  return {
    error: ACH_INITIATION_FAILED,
    message: ACH_INITIATION_FAILED_MESSAGE,
  };
}

module.exports = {
  isChimePartnerBank,
  achInitiationFailure,
  CHIME_ACH_NOT_SUPPORTED,
  ACH_INITIATION_FAILED,
  CHIME_ACH_NOT_SUPPORTED_MESSAGE,
  ACH_INITIATION_FAILED_MESSAGE,
  CHIME_PARTNER_ROUTING_NUMBERS,
};

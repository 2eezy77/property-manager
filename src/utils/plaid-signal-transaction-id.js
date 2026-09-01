/**
 * Plaid Signal /signal/evaluate requires client_transaction_id of 1–36 characters.
 * `rent-<uuid>` is 41 chars and 400s the request before Stripe is called.
 */

const PLAID_SIGNAL_TXN_ID_MAX = 36;

function signalClientTransactionId(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return String(Date.now()).slice(0, PLAID_SIGNAL_TXN_ID_MAX);
  return raw.length <= PLAID_SIGNAL_TXN_ID_MAX ? raw : raw.slice(0, PLAID_SIGNAL_TXN_ID_MAX);
}

module.exports = {
  signalClientTransactionId,
  PLAID_SIGNAL_TXN_ID_MAX,
};

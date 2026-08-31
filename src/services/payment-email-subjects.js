/**
 * Pure subject / display helpers for payment notification emails.
 * Kept separate from payment-email.service.js so unit tests do not need DB/Gmail.
 */

'use strict';

const { formatMoney, formatDate } = require('./email-templates/utils');

function tenantDisplayName(ctx) {
  const name = [ctx?.tenant_first, ctx?.tenant_last].filter(Boolean).join(' ').trim();
  return name || 'Tenant';
}

function paymentTypeNoun(paymentType, { capitalize = false } = {}) {
  const isUtility = paymentType === 'utility';
  if (capitalize) return isUtility ? 'Utility' : 'Rent';
  return isUtility ? 'utility' : 'rent';
}

function paymentReceivedSubjects({ amount, paymentType = 'rent', tenant = 'Tenant' } = {}) {
  const amountStr = formatMoney(amount);
  const noun = paymentTypeNoun(paymentType);
  const Noun = paymentTypeNoun(paymentType, { capitalize: true });
  return {
    tenantSubject: `${Noun} payment confirmed - ${amountStr}`,
    staffSubject: `${tenant} - ${noun} payment received (${amountStr})`,
    amountStr,
  };
}

function paymentFailedSubjects({ amount, paymentType = 'rent', tenant = 'Tenant' } = {}) {
  const amountStr = formatMoney(amount);
  const Noun = paymentTypeNoun(paymentType, { capitalize: true });
  return {
    tenantSubject: `${Noun} payment failed - ${amountStr}`,
    staffSubject: `Payment failed - ${tenant} (${amountStr})`,
    amountStr,
  };
}

function rentDueSubject({ amount, dueDate } = {}) {
  const amountStr = formatMoney(amount);
  const dueStr = formatDate(dueDate);
  return {
    subject: `Rent due ${dueStr} - ${amountStr}`,
    amountStr,
    dueStr,
  };
}

function rentOverdueSubject({ amount, gracePeriodDays = 5 } = {}) {
  const amountStr = formatMoney(amount);
  const grace = gracePeriodDays ?? 5;
  return {
    subject: `Overdue rent - ${amountStr} (late fees after ${grace}-day grace)`,
    amountStr,
    grace,
  };
}

function lateFeeSubjects({ amount, tenant = 'Tenant' } = {}) {
  const amountStr = formatMoney(amount);
  return {
    tenantSubject: `Late fee applied - ${amountStr}`,
    staffSubject: `Late fee applied - ${tenant} (${amountStr})`,
    amountStr,
  };
}

module.exports = {
  tenantDisplayName,
  paymentTypeNoun,
  paymentReceivedSubjects,
  paymentFailedSubjects,
  rentDueSubject,
  rentOverdueSubject,
  lateFeeSubjects,
  formatMoney,
  formatDate,
};

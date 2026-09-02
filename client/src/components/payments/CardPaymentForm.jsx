import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import api from '@/api/axios';
import { apiErrorMessage } from '@/utils/apiErrorMessage';

// Link-by-email often auto-selects a broken Link balance (brand "link" / last4 0000)
// and returns generic_decline — Osanin Sep 2026. Force manual card entry instead.
const CARD_ELEMENT_OPTIONS = {
  paymentMethodOrder: ['card'],
  wallets: { link: 'never', applePay: 'auto', googlePay: 'auto' },
};

const BANK_ELEMENT_OPTIONS = {
  paymentMethodOrder: ['us_bank_account'],
  wallets: { applePay: 'never', googlePay: 'never', link: 'never' },
};

function CardCheckout({ onSuccess, onError, variant = 'card', returnUrl }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const confirmLockRef = useRef(false);
  const isBank = variant === 'bank';

  async function handleSubmit(event) {
    event.preventDefault();
    if (!stripe || !elements) return;
    if (confirmLockRef.current) return;
    confirmLockRef.current = true;

    setSubmitting(true);
    setMessage('');
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: returnUrl || `${window.location.origin}${window.location.pathname}`,
        },
        redirect: 'if_required',
      });

      if (error) {
        confirmLockRef.current = false;
        setSubmitting(false);
        const declineCode = error.decline_code || error.payment_intent?.last_payment_error?.decline_code;
        const pmType = error.payment_method?.type
          || error.payment_intent?.last_payment_error?.payment_method?.type;
        const cardBrand = error.payment_method?.card?.brand
          || error.payment_intent?.last_payment_error?.payment_method?.card?.brand;
        const linkDeclined = !isBank && (
          pmType === 'link'
          || cardBrand === 'link'
          || /link/i.test(error.message || '')
        );
        setMessage(
          linkDeclined
            ? 'Link wallet was declined. Enter your debit or credit card number, or use Cash App / Bank ACH instead.'
            : declineCode === 'generic_decline' && !isBank
              ? 'Card was declined. Try another card, Cash App, or Bank ACH (no fee).'
              : (error.message || (isBank
                ? 'Bank payment could not be completed.'
                : 'Card payment could not be completed.'))
        );
        onError?.(error);
        return;
      }

      onSuccess?.(paymentIntent);
    } catch (err) {
      confirmLockRef.current = false;
      setSubmitting(false);
      const fallback = isBank
        ? 'Bank payment could not be completed.'
        : 'Card payment could not be completed.';
      setMessage(err.message || fallback);
      onError?.(err);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={isBank ? BANK_ELEMENT_OPTIONS : CARD_ELEMENT_OPTIONS} />
      {message && <p className="text-sm text-red-600">{message}</p>}
      <button
        type="submit"
        disabled={!stripe || !elements || submitting}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting
          ? 'Confirming...'
          : isBank
            ? 'Confirm bank ACH payment'
            : 'Confirm card payment'}
      </button>
    </form>
  );
}

function paymentTypesMatchVariant(variant, types) {
  if (!Array.isArray(types) || types.length === 0) return true;
  if (variant === 'bank') {
    return types.includes('us_bank_account') && !types.includes('card');
  }
  return types.includes('card') && !types.includes('us_bank_account');
}

export default function CardPaymentForm({
  clientSecret,
  publishableKey,
  paymentMethodTypes,
  onSuccess,
  onError,
  variant = 'card',
  returnUrl,
}) {
  const [configKey, setConfigKey] = useState(publishableKey || '');
  const [loadingConfig, setLoadingConfig] = useState(!publishableKey);
  const [configError, setConfigError] = useState('');

  useEffect(() => {
    if (publishableKey) {
      setConfigKey(publishableKey);
      setLoadingConfig(false);
      return undefined;
    }

    let cancelled = false;
    async function loadConfig() {
      setLoadingConfig(true);
      setConfigError('');
      try {
        const { data } = await api.get('/api/payments/stripe-config');
        if (!cancelled) setConfigKey(data.publishableKey || '');
      } catch (err) {
        if (!cancelled) setConfigError(apiErrorMessage(err, 'Could not load Stripe configuration.'));
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    }

    loadConfig();
    return () => { cancelled = true; };
  }, [publishableKey]);

  const stripePromise = useMemo(
    () => (configKey ? loadStripe(configKey) : null),
    [configKey]
  );

  if (!clientSecret) return null;

  if (!paymentTypesMatchVariant(variant, paymentMethodTypes)) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {variant === 'bank'
          ? 'Bank ACH checkout received a non-ACH payment form. Refresh and use Bank (ACH) again.'
          : 'Card / Link checkout received a non-card payment form. Refresh and try again.'}
      </p>
    );
  }

  if (loadingConfig) {
    return (
      <p className="text-sm text-slate-500">
        {variant === 'bank' ? 'Loading secure bank form...' : 'Loading secure card form...'}
      </p>
    );
  }

  if (configError || !stripePromise) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {configError || (variant === 'bank'
          ? 'Bank ACH payments are not configured yet.'
          : 'Card payments are not configured yet.')}
      </p>
    );
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CardCheckout
        variant={variant}
        returnUrl={returnUrl}
        onSuccess={onSuccess}
        onError={onError}
      />
    </Elements>
  );
}

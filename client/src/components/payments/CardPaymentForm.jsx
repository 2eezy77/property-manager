import React, { useEffect, useMemo, useState } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import api from '@/api/axios';
import { apiErrorMessage } from '@/utils/apiErrorMessage';

function CardCheckout({ onSuccess, onError }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setMessage('');
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}${window.location.pathname}`,
        },
        redirect: 'if_required',
      });

      if (error) {
        setMessage(error.message || 'Card payment could not be completed.');
        onError?.(error);
        return;
      }

      onSuccess?.(paymentIntent);
    } catch (err) {
      const fallback = 'Card payment could not be completed.';
      setMessage(err.message || fallback);
      onError?.(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {message && <p className="text-sm text-red-600">{message}</p>}
      <button
        type="submit"
        disabled={!stripe || !elements || submitting}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
      >
        {submitting ? 'Confirming...' : 'Confirm card payment'}
      </button>
    </form>
  );
}

export default function CardPaymentForm({ clientSecret, publishableKey, onSuccess, onError }) {
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

  if (loadingConfig) {
    return <p className="text-sm text-slate-500">Loading secure card form...</p>;
  }

  if (configError || !stripePromise) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {configError || 'Card payments are not configured yet.'}
      </p>
    );
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CardCheckout onSuccess={onSuccess} onError={onError} />
    </Elements>
  );
}

# Stripe webhook events (production)

Production endpoint: `POST https://www.monterorentals.com/webhooks/stripe`  
(also accepted: `https://monterorentals.com/webhooks/stripe`)

The app verifies `STRIPE_WEBHOOK_SECRET` and acknowledges with `200` before processing (except Identity events, which are awaited).

## Required event types

These must be selected on the live Stripe Dashboard webhook (Developers → Webhooks → the monterorentals.com endpoint). Code lists them in `ALL_WEBHOOK_EVENTS` (`src/services/stripe.service.js`).

**PaymentIntents**

- `payment_intent.processing`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`

**Charges / refunds (Dashboard refunds land here)**

- `charge.pending`
- `charge.succeeded`
- `charge.failed`
- `charge.refunded` — **required for Dashboard refunds** (this is the Isaiah 2026-09 miss)
- `charge.refund.updated`
- `refund.created`
- `refund.updated`
- `charge.dispute.created`

**Other**

- `account.updated`
- `identity.verification_session.verified`
- `identity.verification_session.requires_input`
- `identity.verification_session.canceled`
- `identity.verification_session.processing`

`charge.pending` / `charge.succeeded` / `charge.failed` are already handled in `src/webhooks/stripe.webhook.js`. They may already be selected in the Dashboard even if an older sync list omitted them. **`charge.refunded` was not handled and is usually not selected unless added.**

## How to add the refund events (do not skip)

1. Stripe Dashboard → Developers → Webhooks → the production URL above.
2. Add events: `charge.refunded`, `charge.refund.updated`, `refund.created`, `refund.updated`.
3. Or merge from this repo (live secret, write access):  
   `npm run stripe:webhook-events:dry` then `npm run stripe:webhook:sync`.
4. Confirm with `npm run payments:health` — `stripe.webhook_events` should pass.

This repo does **not** change the Stripe Dashboard by itself. A Dashboard or `stripe:webhook:sync` step is required after deploy.

## What a Dashboard refund does in the portal

- Stripe sends `charge.refunded` (Charge: `id`, `payment_intent`, `amount`, `amount_refunded`, `refunded`).
- The webhook maps the Charge to `payments` by `stripe_charge_id` or `stripe_payment_intent_id`.
- Full refund (`charge.refunded === true` or `amount_refunded >= amount`) → local status `refunded`.
- Partial (`amount_refunded` between 1 and amount-1) → `partially_refunded` (existing enum; that row no longer counts as paid).
- `payments.amount` stays the ledger base (e.g. $450). Stripe cents include the card fee; we do not rewrite the ledger amount.
- Paid-vs-owed only sums `status = 'succeeded'`, so a refunded September charge drops out. A second succeeded charge for the same month still counts.
- Replays of the same event id, or a later event on an already-`refunded` row, are no-ops.

Replay a missed live event from the Dashboard event log after the endpoint includes `charge.refunded`.

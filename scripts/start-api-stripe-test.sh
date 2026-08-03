#!/usr/bin/env bash
# Start the API with Stripe TEST keys from .env.local for Identity demos.
# Requires STRIPE_WEBHOOK_SECRET from `stripe listen` (or STRIPE_WEBHOOK_SECRET_OVERRIDE).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env.local}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy from .env.example and add Stripe TEST keys + webhook secret." >&2
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    ''|\#*) continue ;;
    STRIPE_SECRET_KEY=*|STRIPE_PUBLISHABLE_KEY=*|IDENTITY_PII_ENCRYPTION_KEY=*|STRIPE_WEBHOOK_SECRET=*)
      export "$line"
      ;;
  esac
done < "$ENV_FILE"

if [[ -n "${STRIPE_WEBHOOK_SECRET_OVERRIDE:-}" ]]; then
  export STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET_OVERRIDE"
fi

if [[ -z "${STRIPE_WEBHOOK_SECRET:-}" ]]; then
  echo "STRIPE_WEBHOOK_SECRET is not set." >&2
  echo "Run: npm run stripe:listen  → copy the printed whsec_… into $ENV_FILE" >&2
  echo "Or:  STRIPE_WEBHOOK_SECRET_OVERRIDE=whsec_… $0" >&2
  exit 1
fi

if [[ ! "$STRIPE_WEBHOOK_SECRET" =~ ^whsec_ ]]; then
  echo "STRIPE_WEBHOOK_SECRET must start with whsec_" >&2
  exit 1
fi

echo "starting api stripe=$(printf '%s' "${STRIPE_SECRET_KEY:-}" | cut -c1-7) whsec=$(printf '%s' "$STRIPE_WEBHOOK_SECRET" | cut -c1-7)…"
exec npm run dev

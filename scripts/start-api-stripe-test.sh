#!/usr/bin/env bash
set -euo pipefail
cd /workspace
while IFS= read -r line; do
  case "$line" in
    STRIPE_SECRET_KEY=*|STRIPE_PUBLISHABLE_KEY=*|IDENTITY_PII_ENCRYPTION_KEY=*)
      export "$line"
      ;;
  esac
done < .env.local
export STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET_OVERRIDE:-whsec_52babaa812b400cb2bf7e420312bfb8b7fdd54b216aef76b0de59dd0b2aa44b2}"
echo "starting api stripe=$(printf '%s' "$STRIPE_SECRET_KEY" | cut -c1-7) whsec=$(printf '%s' "$STRIPE_WEBHOOK_SECRET" | cut -c1-12)"
exec npm run dev

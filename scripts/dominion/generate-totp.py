#!/usr/bin/env python3
"""
DEPRECATED — Dominion Energy does not support authenticator-app TOTP.

Dominion MFA is SMS or email verification codes only.
Use: node scripts/dominion/fetch-email-otp.js  (after choosing email OTP at login)
"""
from __future__ import annotations

import sys

print(
    "Dominion Energy does not support TOTP authenticator apps.\n"
    "Use email MFA + `node scripts/dominion/fetch-email-otp.js` instead.\n"
    "See scripts/dominion/README.md.",
    file=sys.stderr,
)
sys.exit(2)

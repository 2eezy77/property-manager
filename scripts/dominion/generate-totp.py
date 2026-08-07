#!/usr/bin/env python3
"""Generate the current Dominion MFA TOTP code from DOMINION_TOTP_SECRET."""
from __future__ import annotations

import os
import sys

try:
    import pyotp
except ImportError:
    print("pyotp missing — run: pip install pyotp", file=sys.stderr)
    sys.exit(1)


def main() -> int:
    secret = (os.environ.get("DOMINION_TOTP_SECRET") or "").strip().replace(" ", "")
    if not secret:
        print("DOMINION_TOTP_SECRET is not set", file=sys.stderr)
        return 1
    try:
        totp = pyotp.TOTP(secret)
        code = totp.now()
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to generate TOTP: {exc}", file=sys.stderr)
        return 1
    # Remaining seconds in this 30s window (useful for browser race).
    remaining = totp.interval - (pyotp.time.time() % totp.interval)
    print(code)
    print(f"# valid_for_seconds={int(remaining)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# Task 7 Report: Wire full QA script + env docs

## STATUS

Complete.

## COMMITS

- `test(identity): invite + activation gate QA and env docs`

## TEST

- `npm run test:identity-crypto` passed (`OK identity crypto`).
- `npm run test:lease-invite-identity` passed 24/24, including invite create, tenant password setup, native signing, identity fee/session, verified-before-deposit activation, and deposit-before-identity `awaiting_identity` then activation.
- `npm run test:identity:all` passed, verifying the new aggregate package script.
- `npm run test:native-lease:all` passed, including `test-native-lease` 15/15 with verified identity seeded before deposit activation.

## CONCERNS

- Stripe Identity hosted-session assertions depend on Stripe Identity being available; the QA script skips only the live hosted-session portions if Stripe reports Identity/account restrictions, while still simulating verified identity for the activation gate.

# Final fix report - lease invite Stripe Identity review

## Fix notes

- Stripe Identity session creation now requests document verification restricted to `driving_license`, requires matching selfie, and requires `id_number` collection.
- Identity verified-session processing now expands/retrieves `verified_outputs` before persisting, requires legal name plus encryptable 9-digit SSN/id_number, and fails closed with `IDENTITY_COLLECTIONS_PROFILE_MISSING` instead of storing `verified` without SSN ciphertext.
- Verified Identity rows are terminal for fee/session APIs: both return `409 IDENTITY_ALREADY_VERIFIED` without Stripe fee/session calls.
- Identity fee, session, and webhook processing paths validate `IDENTITY_PII_ENCRYPTION_KEY` before work starts.
- Stripe webhook handling now awaits Identity events and returns 500 on Identity processing failure so Stripe can retry; non-Identity events keep the existing async acknowledgement behavior.
- Native lease invite creation now surfaces `inviteSent: false` with `inviteReason` and `inviteMessage`; manager UI shows a warning toast when the lease is created but invite email sending fails.
- Tenant invite email copy now tells tenants Stripe Identity will verify driver's license plus SSN/id number and that the verification fee is tenant-paid.
- QA now sets a deterministic local Identity PII key, verifies Stripe Identity API options, checks missing-SSN fail-closed behavior, asserts encrypted SSN persistence for happy-path verified updates, seeds simulated verified identities with encrypted SSN, and checks terminal verified fee/session behavior.

## Test output

### `npm run test:identity:all`

```text
> property-manager-server@0.1.0 test:identity:all
> npm run test:identity-crypto && npm run test:lease-invite-identity


> property-manager-server@0.1.0 test:identity-crypto
> node scripts/test-identity-crypto.js

OK identity crypto

> property-manager-server@0.1.0 test:lease-invite-identity
> node scripts/test-lease-invite-identity.js


-- Native activation gate --
  ✓ Stripe Identity session requests driver license plus id_number outputs
  ✓ identity fee/session paths require PII encryption key before work starts
  ✓ verified identity without SSN/id_number fails closed
  ✓ verified identity persists encrypted SSN/id_number collections profile
  ✓ verified identity is terminal for fee and hosted session APIs
  ✓ deposit success without verified identity moves native lease to awaiting_identity
  ✓ deposit success with incomplete identity keeps native lease awaiting_identity
  ✓ deposit success with verified identity activates native lease
  ✓ identity verified before deposit leaves native lease awaiting_deposit
  ✓ identity verified after deposit activates native lease
  ✓ verified identity ignores out-of-order downgrade webhooks
[stripe-webhook] charge succeeded: ch_charge_deposit ($1000.00) [security_deposit]
  ✓ charge.succeeded deposit without verified identity moves native lease to awaiting_identity
[stripe-webhook] charge succeeded: ch_charge_deposit ($1000.00) [security_deposit]
  ✓ charge.succeeded deposit with verified identity activates native lease
  ✓ identity failure staff alert redacts SSN-like strings

-- Lease create tenant invite --
  ✓ staff can log in
  ✓ lease-create tenant picker includes org tenant without lease (UNION branch)
  ✓ invite without phone is rejected with phone validation
  ✓ native draft lease is created for invited tenant
  ✓ invited tenant user has org_id and phone
  ✓ lease-create tenant picker includes invited org tenant
  ✓ identity session is blocked until tenant pays the identity fee
  ✓ identity fee intent uses locked base amount and card processing fee
  ✓ identity hosted session is created after fee payment
  ✓ identity session update marks the lease identity verified
  ✓ invited tenant lease completes native signing path
  ✓ verified identity plus deposit settlement activates invited native lease
  ✓ deposit settlement without verified identity leaves invited native lease awaiting_identity
  ✓ identity verification after deposit activates invited native lease
  ✓ duplicate tenant invite asks staff to use Existing tenant

======================================================
  LEASE INVITE API: 29 passed · 0 failed
======================================================
```

### `npm run test:native-lease:all`

```text
> property-manager-server@0.1.0 test:native-lease:all
> npm run test:native-lease-defaults && npm run test:native-lease-pdf && npm run test:native-lease


> property-manager-server@0.1.0 test:native-lease-defaults
> node scripts/test-native-lease-defaults.js

OK native lease defaults

> property-manager-server@0.1.0 test:native-lease-pdf
> node scripts/test-native-lease-pdf.js

OK room lease PDF

> property-manager-server@0.1.0 test:native-lease
> node scripts/test-native-lease.js


-- Native lease API flow --
  ✓ staff and tenant can log in
  ✓ seed tenant resolved
  ✓ native draft created with regular room defaults
  ✓ native PDF generated
  ✓ native document URL returned to tenant
  ✓ native envelope created for tenant then manager
  ✓ tenant signature advances to manager signature
  ✓ manager signature flattens PDF and awaits deposit
  ✓ pending security deposit payment row created
  ✓ card security deposit PaymentIntent can be created while awaiting deposit
  ✓ card deposit create-intent applies 2.9%+$0.30 processing fee
  ✓ second deposit create-intent replaces prior open PI (cancel-then-overwrite)
  ✓ manager signing fee row created as pending rent
  ✓ Rocket Lawyer document creation is blocked for native lease
  ✓ verified tenant identity allows security deposit settlement to activate lease

======================================================
  NATIVE LEASE API: 15 passed · 0 failed
======================================================
```

### `npm run build`

```text
> property-manager-server@0.1.0 build
> cd client && npm install && npm run build


up to date, audited 168 packages in 613ms

31 packages are looking for funding
  run `npm fund` for details

4 vulnerabilities (1 moderate, 3 high)

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.

> property-manager-client@0.1.0 build
> vite build

vite v5.4.21 building for production...
transforming...
✓ 1953 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                     1.34 kB │ gzip:   0.62 kB
dist/assets/index-Do2pCtDr.css     76.26 kB │ gzip:  12.87 kB
dist/assets/index-OFiZTYXq.js   1,366.87 kB │ gzip: 307.37 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 3.51s
```

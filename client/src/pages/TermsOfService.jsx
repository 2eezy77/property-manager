/**
 * Public terms of service — Google OAuth consent screen and tenant transparency.
 */
import React from 'react';
import { Link } from 'react-router-dom';

const EFFECTIVE = 'June 5, 2026';
const CONTACT = 'josemontero2002@gmail.com';

function Section({ title, children }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

export default function TermsOfService() {
  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/login" className="text-sm font-semibold text-violet-700 hover:text-violet-900">
            ← Montero Rentals
          </Link>
          <p className="text-xs text-slate-400">Effective {EFFECTIVE}</p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-2 text-2xl font-bold text-slate-900">Terms of Service</h1>
        <p className="mb-8 text-sm text-slate-500">
          These terms govern use of the Montero Rentals portal at
          {' '}
          <strong className="font-medium text-slate-700">www.monterorentals.com</strong>
          . By creating an account or signing in, you agree to these terms and our
          {' '}
          <Link to="/privacy" className="font-medium text-violet-700 hover:underline">Privacy Policy</Link>.
        </p>

        <Section title="The service">
          <p>
            Montero Rentals is an online portal operated by Jose I. Montero for managing residential
            leases, rent payments, utilities, maintenance, and related communications for
            743 A Ave, Norfolk, VA. Features vary by role (tenant, property manager, or owner).
          </p>
        </Section>

        <Section title="Eligibility and accounts">
          <p>
            You must be at least 18 years old. Tenant accounts are issued to individuals with an active
            lease or authorized by property management. You are responsible for keeping your password
            confidential and for activity under your account. Notify us immediately if you suspect
            unauthorized access.
          </p>
        </Section>

        <Section title="Rent, utilities, and payments">
          <p>
            When you link a bank account through Plaid and authorize a payment, you instruct us to
            initiate ACH debits through Stripe for rent, utility shares, fees, or other charges shown
            in the portal. You agree to maintain sufficient funds and to review amounts before confirming
            payment. Payment timing and amounts follow your lease and notices in the portal.
          </p>
          <p>
            Bank linking is voluntary but required to pay through the portal. You may remove a linked
            account from Payments settings at any time; outstanding balances may still be owed under
            your lease.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>You agree not to:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Use the portal for unlawful purposes or to harass others.</li>
            <li>Share login credentials or impersonate another user.</li>
            <li>Attempt to access data or areas of the system you are not permitted to use.</li>
            <li>Disrupt or probe the security of the service.</li>
          </ul>
        </Section>

        <Section title="Communications">
          <p>
            We may send transactional email and in-portal messages about rent, maintenance, utilities,
            and account security. Connecting Gmail (owner only) enables outbound mail on behalf of the
            property. Message content should remain professional and related to property management.
          </p>
        </Section>

        <Section title="Availability and changes">
          <p>
            We strive to keep the portal available but do not guarantee uninterrupted access. We may
            modify features, suspend access for maintenance or security, or update these terms. Material
            changes will be reflected by updating the effective date above. Continued use after changes
            means you accept the updated terms.
          </p>
        </Section>

        <Section title="Disclaimer">
          <p>
            The portal is provided &quot;as is&quot; for property management convenience. To the extent
            permitted by law, Montero Rentals is not liable for indirect or consequential damages arising
            from use of the service. Nothing in these terms limits rights you may have under applicable
            landlord-tenant or consumer protection laws.
          </p>
        </Section>

        <Section title="Governing law">
          <p>
            These terms are governed by the laws of the Commonwealth of Virginia, without regard to
            conflict-of-law rules. Disputes should first be raised with property management at the
            contact below.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Jose I. Montero — Montero Rentals
            <br />
            Email:
            {' '}
            <a href={`mailto:${CONTACT}`} className="font-medium text-violet-700 hover:underline">
              {CONTACT}
            </a>
          </p>
        </Section>

        <p className="mt-10 border-t border-slate-200 pt-6 text-center text-xs text-slate-400">
          <Link to="/login" className="text-violet-600 hover:underline">Return to sign in</Link>
          {' · '}
          <Link to="/privacy" className="text-violet-600 hover:underline">Privacy Policy</Link>
        </p>
      </main>
    </div>
  );
}

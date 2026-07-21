/**
 * Public privacy policy — required for Plaid production diligence and tenant transparency.
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

export default function PrivacyPolicy() {
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
        <h1 className="mb-2 text-2xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="mb-8 text-sm text-slate-500">
          This policy describes how Montero Rentals collects, uses, and protects information when you use
          {' '}
          <strong className="font-medium text-slate-700">www.monterorentals.com</strong>
          .
        </p>

        <Section title="Who we are">
          <p>
            Montero Rentals is operated by Jose I. Montero for residential property management at
            743 A Ave, Norfolk, VA. For privacy questions or requests, contact
            {' '}
            <a href={`mailto:${CONTACT}`} className="font-medium text-violet-700 hover:underline">
              {CONTACT}
            </a>
            .
          </p>
        </Section>

        <Section title="Information we collect">
          <p>Depending on how you use the portal, we may collect:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="font-medium text-slate-800">Account information</strong>
              {' '}
              — name, email address, and role (tenant, property manager, or owner).
            </li>
            <li>
              <strong className="font-medium text-slate-800">Lease and property data</strong>
              {' '}
              — unit assignment, rent amount, lease dates, maintenance requests, and messages.
            </li>
            <li>
              <strong className="font-medium text-slate-800">Payment information</strong>
              {' '}
              — rent payment history, late fees, and utility bill splits. Bank account linking is handled
              through Plaid; we store encrypted Plaid tokens and display bank name and last-four digits only.
            </li>
            <li>
              <strong className="font-medium text-slate-800">Technical data</strong>
              {' '}
              — standard server logs (IP address, browser type, timestamps) for security and troubleshooting.
            </li>
          </ul>
        </Section>

        <Section title="How we use your information">
          <p>We use collected information to:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Operate the tenant and owner portal (rent, maintenance, messaging, utilities).</li>
            <li>Process rent and related charges through Stripe ACH when you authorize payment.</li>
            <li>Link bank accounts through Plaid when you choose to connect an account.</li>
            <li>Send transactional email (payment confirmations, maintenance updates) via our connected Gmail account.</li>
            <li>Meet legal, accounting, and property-management obligations.</li>
          </ul>
          <p>We do not sell your personal information.</p>
        </Section>

        <Section title="Bank linking (Plaid) and payments (Stripe)">
          <p>
            When you click
            {' '}
            <strong className="font-medium text-slate-800">Connect with Plaid</strong>
            , you are sent to Plaid Link to authenticate with your financial institution. Plaid provides us
            with account identifiers and routing details needed to set up ACH payments. We do not store your
            online banking username or password.
          </p>
          <p>
            Plaid access tokens are encrypted at rest on our servers (AES-256-GCM). Rent debits are processed
            by Stripe using the bank account you linked. Plaid and Stripe have their own privacy policies
            governing their services.
          </p>
          <p>
            Linking a bank account is
            {' '}
            <strong className="font-medium text-slate-800">voluntary</strong>
            . By completing Plaid Link, you consent to us collecting and using bank connection data for rent
            collection and related property payments described in this policy.
          </p>
        </Section>

        <Section title="Who can see your data">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="font-medium text-slate-800">Tenants</strong>
              {' '}
              — their own lease, payments, maintenance, and messages.
            </li>
            <li>
              <strong className="font-medium text-slate-800">Property manager</strong>
              {' '}
              — operational data for the property (not tenant bank login credentials).
            </li>
            <li>
              <strong className="font-medium text-slate-800">Owners</strong>
              {' '}
              — financial summaries, audit logs, and property operating accounts they manage.
            </li>
            <li>
              <strong className="font-medium text-slate-800">Service providers</strong>
              {' '}
              — Railway (hosting), Supabase (database), Plaid, Stripe, Cloudflare, and Google (Gmail API) process
              data on our behalf under their terms.
            </li>
          </ul>
        </Section>

        <Section title="Security">
          <p>
            We protect data in transit with HTTPS (TLS). Passwords are hashed with bcrypt. Sensitive tokens
            (Plaid, Gmail) are encrypted at rest. Access is limited by role-based permissions. Administrative
            accounts for hosting and payment providers require multi-factor authentication where supported.
          </p>
        </Section>

        <Section title="Retention and deletion">
          <p>
            We retain account and payment records while you have an active lease or as needed for taxes,
            accounting, and dispute resolution. You may remove a linked bank account at any time from the
            Payments page (tenants) or the relevant finance settings (owners/managers).
          </p>
          <p>
            After move-out, we may retain payment and lease records for up to seven years for legal and
            accounting purposes, then delete or anonymize data that is no longer required. To request deletion
            of your account data, email
            {' '}
            <a href={`mailto:${CONTACT}`} className="font-medium text-violet-700 hover:underline">
              {CONTACT}
            </a>
            .
          </p>
        </Section>

        <Section title="Children">
          <p>
            This service is not directed to individuals under 18. We do not knowingly collect data from children.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            We may update this policy from time to time. The effective date at the top of this page will change
            when we do. Continued use of the portal after changes constitutes acceptance of the updated policy.
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
          <Link to="/terms" className="text-violet-600 hover:underline">Terms of Service</Link>
        </p>
      </main>
    </div>
  );
}

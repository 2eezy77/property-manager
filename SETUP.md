# Property Manager — First-Run Setup

Follow these steps in order. You only need to do this once.

---

## Step 1 — Create a Supabase project (free)

1. Go to **[supabase.com](https://supabase.com)** and sign up or log in
2. Click **New project**
3. Name it `property-manager`, pick the region closest to you (US East is fine), set a database password — **save that password**
4. Wait ~2 minutes for the project to spin up

---

## Step 2 — Get your database connection string

1. In your Supabase project, go to **Settings → Database**
2. Scroll to **Connection string**, select the **URI** tab
3. Copy the string — it looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxxxxxx.supabase.co:5432/postgres
   ```
4. Replace `[YOUR-PASSWORD]` with the password you set in Step 1

---

## Step 3 — Fill in your `.env` file

In the `property-manager` folder, copy the example file:

```bash
cp .env.example .env
```

Open `.env` and fill in every `REPLACE_ME` value:

| Key | Where to get it |
|-----|----------------|
| `DATABASE_URL` | Paste the URI from Step 2 |
| `JWT_ACCESS_SECRET` | Run: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` |
| `JWT_REFRESH_SECRET` | Run the same command again (must be different) |
| `ENCRYPTION_KEY` | Run: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `PLAID_CLIENT_ID` | [dashboard.plaid.com](https://dashboard.plaid.com) → Team Settings → Keys |
| `PLAID_SECRET` | Same page, copy the **Sandbox** secret |
| `STRIPE_SECRET_KEY` | [dashboard.stripe.com](https://dashboard.stripe.com) → Developers → API keys → Secret key |
| `STRIPE_WEBHOOK_SECRET` | See Step 5 below |

Leave `PLAID_ENV=sandbox` and `NODE_ENV=development` as-is for now.

---

## Step 4 — Run migrations and seed

```bash
# In the property-manager folder
npm install
npm run db:setup
```

`db:setup` runs migrate then seed in one command. When it finishes, it prints:

```
┌──────────────────────────────────────────────┐
│  🎉  SETUP COMPLETE — YOUR LOGIN CREDENTIALS  │
│                                              │
│   URL:       http://localhost:5173           │
│   Email:     owner@example.com (owner)       │
│   Password:  YOUR_GENERATED_PASSWORD         │
│                                              │
│   ⚠️  Save this password — shown only once.  │
└──────────────────────────────────────────────┘
```

**Save that password.** It's generated randomly and not stored anywhere else.

---

## Step 5 — Set up the Stripe webhook secret

Open a **second terminal** and run:

```bash
stripe listen --forward-to localhost:3001/webhooks/stripe
```

The CLI prints:
```
> Ready! Your webhook signing secret is whsec_a1b2c3...
```

Copy `whsec_a1b2c3...` into your `.env`:
```
STRIPE_WEBHOOK_SECRET=whsec_a1b2c3...
```

Leave this terminal running whenever you're developing.

> **Don't have the Stripe CLI?**
> Download it at [stripe.com/docs/stripe-cli](https://stripe.com/docs/stripe-cli). It's a one-click installer.

---

## Step 6 — Start everything

You need three terminals running simultaneously:

**Terminal 1 — Backend API**
```bash
cd property-manager
npm run dev
# → Server running on http://localhost:3001
```

**Terminal 2 — Frontend**
```bash
cd property-manager/client
npm install
npm run dev
# → Local: http://localhost:5173
```

**Terminal 3 — Stripe webhooks** *(already running from Step 5)*
```bash
stripe listen --forward-to localhost:3001/webhooks/stripe
```

Open **[http://localhost:5173](http://localhost:5173)** in your browser. Log in with the credentials from Step 4.

---

## Troubleshooting

**"DATABASE_URL is not set"**
→ Make sure `.env` exists (not just `.env.example`) and you're running commands from the `property-manager` folder.

**"relation does not exist" during seed**
→ The migration didn't finish. Run `npm run db:migrate` again and check for errors.

**"Cannot find module 'bcrypt'"**
→ Run `npm install` in the `property-manager` folder first.

**Login fails even with correct credentials**
→ Make sure the backend server (Terminal 1) is running on port 3001.

**Forgot your password**
```bash
npm run db:reset-password
```
This generates a new password and prints it to the terminal.

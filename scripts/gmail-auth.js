#!/usr/bin/env node
/**
 * One-time Gmail OAuth (CLI). Opens browser, prints refresh token for .env.local.
 *
 *   node scripts/gmail-auth.js
 *
 * Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI in .env.local.
 * Paste the printed GMAIL_REFRESH_TOKEN into .env.local (or use Connect Gmail in the UI).
 */

require('../src/config/env');
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');
const pool = require('../src/db/client');
const { encrypt } = require('../src/utils/encryption');
const { SCOPES } = require('../src/services/gmail.service');

const saveDb = process.argv.includes('--save-db');
const PORT = Number(process.env.GMAIL_AUTH_PORT || 8099);

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  // CLI uses its own callback port — do not reuse the Express redirect URI.
  const redirectUri = process.env.GMAIL_AUTH_REDIRECT_URI
    || `http://localhost:${PORT}/callback`;

  if (!clientId || !clientSecret) {
    console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local');
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl);
  console.log(`\nWaiting for callback on ${redirectUri} …\n`);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const err = url.searchParams.get('error');
      if (err) {
        res.writeHead(400);
        res.end(`OAuth error: ${err}`);
        reject(new Error(err));
        server.close();
        return;
      }
      const c = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Gmail connected</h1><p>Return to the terminal for your refresh token.</p>');
      resolve(c);
      server.close();
    });
    server.listen(PORT, () => {});
  });

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error('No refresh token — revoke app access at https://myaccount.google.com/permissions and retry.');
    process.exit(1);
  }

  oauth2.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const profile = await gmail.users.getProfile({ userId: 'me' });

  console.log('Add to .env.local:\n');
  console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log(`GMAIL_ADDRESS=${profile.data.emailAddress}`);

  if (saveDb) {
    const { rows: [org] } = await pool.query(`SELECT org_id FROM gmail_oauth_tokens LIMIT 1`);
    const orgId = org?.org_id || (await pool.query(`SELECT id FROM organizations LIMIT 1`)).rows[0]?.id;
    if (!orgId) {
      console.error('\nNo organization found — run db:seed first.');
      process.exit(1);
    }
    const encrypted = encrypt(tokens.refresh_token);
    await pool.query(
      `INSERT INTO gmail_oauth_tokens (org_id, refresh_token_encrypted, gmail_address, scopes, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (org_id) DO UPDATE SET
         refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         gmail_address           = EXCLUDED.gmail_address,
         scopes                  = EXCLUDED.scopes,
         updated_at              = NOW()`,
      [orgId, encrypted, profile.data.emailAddress, SCOPES.join(' ')]
    );
    console.log(`\nSaved Gmail token to DB for org ${orgId} (readonly + send).`);
    await pool.end();
  }

  console.log('\nRestart the backend, then use Import from Gmail in Utilities.');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});

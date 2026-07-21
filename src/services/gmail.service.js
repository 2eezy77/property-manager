/**
 * Gmail OAuth + read-only inbox access for utility e-bill import.
 * One connection per organization — shared by owner and property managers.
 */

const crypto = require('crypto');
const { google } = require('googleapis');
const pool = require('../db/client');
const { encrypt, decrypt } = require('../utils/encryption');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];
const pendingStates = new Map();
const CONNECT_ROLES = new Set(['owner']);

function normalizeProductionRedirectUri(uri) {
  if (!uri || process.env.NODE_ENV !== 'production') return uri;
  try {
    const u = new URL(uri);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return uri;
    u.protocol = 'https:';
    if (!u.hostname.startsWith('www.')) u.hostname = `www.${u.hostname}`;
    return u.toString();
  } catch {
    return uri;
  }
}

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = normalizeProductionRedirectUri(
    process.env.GOOGLE_REDIRECT_URI
      || `${process.env.CLIENT_ORIGIN?.replace(':5173', ':8080') || 'http://localhost:8080'}/api/utilities/gmail/callback`
  );

  if (!clientId || !clientSecret) {
    const err = new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  return { clientId, clientSecret, redirectUri };
}

function createOAuthClient(tokens) {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  if (tokens) client.setCredentials(tokens);
  return client;
}

async function resolveOrgId(userId, role) {
  const { rows } = await pool.query(
    `SELECT org_id FROM users WHERE id = $1`,
    [userId]
  );
  if (rows[0]?.org_id) return rows[0].org_id;

  const { rows: assigned } = await pool.query(
    `SELECT p.org_id
       FROM property_assignments pa
       JOIN properties p ON p.id = pa.property_id
      WHERE pa.user_id = $1
      LIMIT 1`,
    [userId]
  );
  if (assigned[0]?.org_id) return assigned[0].org_id;

  const { rows: prop } = await pool.query(
    `SELECT org_id FROM properties
      WHERE address_line1 ILIKE '%743%' OR name ILIKE '%743%'
      LIMIT 1`
  );
  if (prop[0]?.org_id) return prop[0].org_id;

  return null;
}

function canConnectGmail(role) {
  return CONNECT_ROLES.has(role);
}

function createConnectState(orgId, userId) {
  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, { orgId, userId, exp: Date.now() + 10 * 60_000 });
  return state;
}

function consumeConnectState(state) {
  const entry = pendingStates.get(state);
  pendingStates.delete(state);
  if (!entry || entry.exp < Date.now()) return null;
  return entry;
}

async function saveRefreshToken(orgId, refreshToken, gmailAddress, connectedByUserId) {
  const encrypted = encrypt(refreshToken);
  await pool.query(
    `INSERT INTO gmail_oauth_tokens (org_id, refresh_token_encrypted, gmail_address, scopes, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (org_id) DO UPDATE SET
       refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
       gmail_address           = EXCLUDED.gmail_address,
       scopes                  = EXCLUDED.scopes,
       updated_at              = NOW()`,
    [orgId, encrypted, gmailAddress || null, SCOPES.join(' ')]
  );
  void connectedByUserId;
}

async function getStoredRefreshToken(orgId) {
  if (!orgId && process.env.GMAIL_REFRESH_TOKEN) {
    return { refreshToken: process.env.GMAIL_REFRESH_TOKEN, gmailAddress: process.env.GMAIL_ADDRESS || null };
  }
  if (!orgId) return null;

  if (process.env.GMAIL_REFRESH_TOKEN) {
    return { refreshToken: process.env.GMAIL_REFRESH_TOKEN, gmailAddress: process.env.GMAIL_ADDRESS || null };
  }

  const { rows } = await pool.query(
    `SELECT refresh_token_encrypted, gmail_address FROM gmail_oauth_tokens WHERE org_id = $1`,
    [orgId]
  );
  if (!rows[0]) return null;
  return {
    refreshToken: decrypt(rows[0].refresh_token_encrypted),
    gmailAddress: rows[0].gmail_address,
  };
}

async function getConnectionStatus(userId, role) {
  const orgId = await resolveOrgId(userId, role);
  const stored = await getStoredRefreshToken(orgId);
  return {
    connected: !!stored?.refreshToken,
    gmail_address: stored?.gmailAddress || process.env.GMAIL_ADDRESS || null,
    env_token: !!process.env.GMAIL_REFRESH_TOKEN,
    shared: true,
    can_connect: canConnectGmail(role),
    org_id: orgId,
  };
}

function getAuthUrl(userId, role) {
  if (!canConnectGmail(role)) {
    const err = new Error('Only owner accounts can connect Gmail for the organization.');
    err.code = 'FORBIDDEN';
    throw err;
  }

  return resolveOrgId(userId, role).then(orgId => {
    if (!orgId) {
      const err = new Error('Could not resolve organization for Gmail connection.');
      err.code = 'NO_ORG';
      throw err;
    }
    const oauth2 = createOAuthClient();
    const state = createConnectState(orgId, userId);
    const url = oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state,
    });
    return { url, state };
  });
}

async function handleOAuthCallback(code, state) {
  const session = consumeConnectState(state);
  if (!session?.orgId) {
    const err = new Error('OAuth state expired or invalid. Try connecting Gmail again.');
    err.code = 'INVALID_STATE';
    throw err;
  }

  const oauth2 = createOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    const err = new Error('Google did not return a refresh token. Revoke app access at myaccount.google.com/permissions and connect again.');
    err.code = 'NO_REFRESH_TOKEN';
    throw err;
  }

  oauth2.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const profile = await gmail.users.getProfile({ userId: 'me' });

  await saveRefreshToken(session.orgId, tokens.refresh_token, profile.data.emailAddress, session.userId);
  return { org_id: session.orgId, gmail_address: profile.data.emailAddress };
}

async function getGmailClient(userId, role) {
  const orgId = await resolveOrgId(userId, role);
  const stored = await getStoredRefreshToken(orgId);
  if (!stored?.refreshToken) {
    const err = new Error('Gmail is not connected for your organization. An owner must connect Gmail in Utilities.');
    err.code = 'NOT_CONNECTED';
    throw err;
  }

  const oauth2 = createOAuthClient({ refresh_token: stored.refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

function decodeBase64Url(data) {
  if (!data) return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function collectParts(part, out = { text: '', html: '' }) {
  if (!part) return out;
  if (part.mimeType === 'text/plain' && part.body?.data) {
    out.text += decodeBase64Url(part.body.data);
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    out.html += decodeBase64Url(part.body.data);
  }
  for (const child of part.parts || []) collectParts(child, out);
  return out;
}

async function listUtilityMessages(gmail, { maxResults = 25 } = {}) {
  const q = [
    'newer_than:120d',
    '-subject:"thank you for your payment"',
    '-subject:"payment confirmation"',
    '-subject:disconnection',
    '-subject:"power outage"',
    '-subject:"usage alert"',
    '-subject:"energy spend"',
    '(',
    'from:invoicecloud.net',
    'OR from:dominionenergy.com',
    'OR from:domenergyvanccc.com',
    'OR from:domenergyvanc.com',
    'OR from:hrsd.com',
    'OR from:norfolk.gov',
    'OR subject:"your bill is available"',
    'OR subject:"bill is ready"',
    'OR subject:"amount due"',
    'OR subject:invoice#',
    'OR (from:norfolk subject:invoice)',
    ')',
  ].join(' ');

  const list = await gmail.users.messages.list({
    userId: 'me',
    q,
    maxResults,
  });

  return list.data.messages || [];
}

async function getMessage(gmail, messageId) {
  const { data } = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const headers = Object.fromEntries(
    (data.payload?.headers || []).map(h => [h.name.toLowerCase(), h.value])
  );
  const parts = collectParts(data.payload);
  const body = parts.text || stripHtml(parts.html);

  return {
    id: data.id,
    threadId: data.threadId,
    snippet: data.snippet || '',
    from: headers.from || '',
    subject: headers.subject || '',
    date: headers.date || '',
    body,
    html: parts.html,
  };
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  getConnectionStatus,
  getGmailClient,
  listUtilityMessages,
  getMessage,
  canConnectGmail,
  resolveOrgId,
  createOAuthClient,
  getStoredRefreshToken,
  SCOPES,
};

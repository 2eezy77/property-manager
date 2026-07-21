/**
 * auth.routes.js
 * POST /auth/login     — issue access + refresh tokens
 * POST /auth/refresh   — rotate refresh token, issue new access token
 * POST /auth/logout    — revoke the current refresh token
 * GET  /auth/me        — return the authenticated user's profile
 *
 * Security notes:
 *   • Refresh token is sent in an HttpOnly Secure SameSite=Strict cookie
 *     (not in the JSON body) to prevent XSS theft.
 *   • The cookie is rotated on every /refresh call (refresh token rotation).
 *   • All DB calls use parameterised queries via pg (node-postgres).
 */

const express  = require('express');
const bcrypt   = require('bcrypt');


const { signAccessToken, generateRefreshToken, hashRefreshToken } = require('../utils/jwt.utils');
const authenticate = require('../middleware/authenticate');
const { logActivity } = require('../services/activity-audit.service');
const {
  requestPasswordReset,
  completePasswordReset,
} = require('../services/password-reset.service');

const GENERIC_RESET_MSG =
  'If that email is on file, we sent a reset link. Check your inbox (and spam) in a few minutes.';

const router = express.Router();
const pool = require('../db/client'); // reads DATABASE_URL from env automatically

// ── Cookie config ─────────────────────────────────────────────────────────────
const REFRESH_COOKIE_NAME = 'refresh_token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path:     '/auth',          // scoped so the browser only sends it to /auth/*
  maxAge:   30 * 24 * 3600 * 1000, // 30 days in ms
};

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'MISSING_CREDENTIALS', message: 'email and password are required.' });
  }

  try {
    // 1. Look up user by email
    const { rows } = await pool.query(
      `SELECT id, email, password_hash, role, first_name, last_name, is_active
         FROM users WHERE email = $1 LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    const user = rows[0];

    // 2. Timing-safe check — always run bcrypt even on miss to prevent user enumeration
    const dummyHash  = '$2b$12$invalidhashfortimingprotection0000000000000000000000';
    const validHash  = user ? user.password_hash : dummyHash;
    const isMatch    = await bcrypt.compare(password, validHash);

    if (!user || !isMatch || !user.is_active) {
      if (user?.id) {
        logActivity({
          realActorId: user.id,
          displayActorId: user.id,
          method: 'POST',
          path: '/auth/login',
          statusCode: 401,
          body: { email: user.email },
          ip: req.ip,
        }).catch(() => {});
      }
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
    }

    // 3. Issue tokens
    const accessToken             = signAccessToken(user);
    const { raw, hash, expiresAt } = generateRefreshToken();

    // 4. Persist hashed refresh token
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, hash, expiresAt, req.ip, req.headers['user-agent'] ?? null]
    );

    // 5. Update last_login_at
    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);

    logActivity({
      realActorId: user.id,
      displayActorId: user.id,
      method: 'POST',
      path: '/auth/login',
      statusCode: 200,
      body: { email: user.email },
      ip: req.ip,
    }).catch((err) => console.error('[activity-audit login]', err.message));

    // 6. Set refresh token cookie + return access token in body
    res
      .cookie(REFRESH_COOKIE_NAME, raw, COOKIE_OPTIONS)
      .status(200)
      .json({
        accessToken,
        user: {
          id:        user.id,
          email:     user.email,
          role:      user.role,
          firstName: user.first_name,
          lastName:  user.last_name,
        },
      });

  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ── POST /auth/refresh ────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];

  if (!raw) {
    return res.status(401).json({ error: 'MISSING_REFRESH_TOKEN', message: 'No refresh token cookie found.' });
  }

  const hash = hashRefreshToken(raw);

  try {
    // 1. Look up refresh token row
    const { rows } = await pool.query(
      `SELECT rt.id, rt.expires_at, rt.revoked_at,
              u.id AS user_id, u.role, u.email, u.first_name, u.last_name, u.is_active
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1
        LIMIT 1`,
      [hash]
    );

    const record = rows[0];

    if (!record) {
      return res.status(401).json({ error: 'INVALID_REFRESH_TOKEN', message: 'Refresh token not recognised.' });
    }

    // Detect replay of a revoked token → revoke ALL tokens for this user (breach signal)
    if (record.revoked_at) {
      await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1`, [record.user_id]);
      return res.status(401).json({ error: 'TOKEN_REUSE_DETECTED', message: 'Security alert: all sessions have been terminated.' });
    }

    if (new Date(record.expires_at) < new Date()) {
      return res.status(401).json({ error: 'REFRESH_TOKEN_EXPIRED', message: 'Session has expired. Please log in again.' });
    }

    if (!record.is_active) {
      return res.status(401).json({ error: 'ACCOUNT_DISABLED', message: 'Your account has been deactivated.' });
    }

    // 2. Revoke the used token (token rotation)
    await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [record.id]);

    // 3. Issue fresh pair
    const user                        = { id: record.user_id, role: record.role };
    const newAccessToken              = signAccessToken(user);
    const { raw: newRaw, hash: newHash, expiresAt } = generateRefreshToken();

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [record.user_id, newHash, expiresAt, req.ip, req.headers['user-agent'] ?? null]
    );

    res
      .cookie(REFRESH_COOKIE_NAME, newRaw, COOKIE_OPTIONS)
      .status(200)
      .json({ accessToken: newAccessToken });

  } catch (err) {
    console.error('[auth/refresh]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE_NAME];

  if (raw) {
    const hash = hashRefreshToken(raw);
    try {
      const { rows: tok } = await pool.query(
        `SELECT user_id FROM refresh_tokens WHERE token_hash = $1 LIMIT 1`,
        [hash]
      );
      const uid = tok[0]?.user_id;
      if (uid) {
        logActivity({
          realActorId: uid,
          displayActorId: uid,
          method: 'POST',
          path: '/auth/logout',
          statusCode: 200,
          ip: req.ip,
        }).catch(() => {});
      }
    } catch { /* best-effort */ }
    await pool.query(
      `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hash]
    ).catch(err => console.error('[auth/logout] DB error:', err));
  }

  res
    .clearCookie(REFRESH_COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: 0 })
    .status(200)
    .json({ message: 'Logged out successfully.' });
});

// ── POST /auth/forgot-password ────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body ?? {};
  if (!email || !String(email).includes('@')) {
    return res.status(400).json({
      error: 'INVALID_EMAIL',
      message: 'A valid email address is required.',
    });
  }

  try {
    const result = await requestPasswordReset({ email, ip: req.ip });
    if (!result.sent && result.reason && result.reason !== 'no_user') {
      console.error('[auth/forgot-password] email not delivered', {
        reason: result.reason,
        email: result.email || email,
      });
    }
    res.status(200).json({ message: GENERIC_RESET_MSG });
  } catch (err) {
    console.error('[auth/forgot-password]', err);
    res.status(200).json({ message: GENERIC_RESET_MSG });
  }
});

// ── POST /auth/reset-password ─────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body ?? {};
  if (!token || !newPassword) {
    return res.status(400).json({
      error: 'MISSING_FIELDS',
      message: 'token and newPassword are required.',
    });
  }

  try {
    const { email } = await completePasswordReset({
      token,
      newPassword,
      ip: req.ip,
    });

    logActivity({
      realActorId: null,
      displayActorId: null,
      method: 'POST',
      path: '/auth/reset-password',
      statusCode: 200,
      body: { email },
      ip: req.ip,
    }).catch(() => {});

    res.status(200).json({
      message: 'Password updated. You can sign in with your new password.',
      email,
    });
  } catch (err) {
    const status = err.statusCode || (err.code === 'WEAK_PASSWORD' ? 400 : 400);
    res.status(status).json({
      error: err.code || 'RESET_FAILED',
      message: err.message || 'Could not reset password.',
    });
  }
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, role, first_name, last_name, phone, avatar_url, created_at
         FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (!rows[0]) return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });

    const user = rows[0];
    let isPrimaryOwner = false;
    if (user.role === 'owner' || user.role === 'super_admin') {
      const { rows: orgRows } = await pool.query(
        `SELECT 1 FROM organizations WHERE owner_id = $1 LIMIT 1`,
        [user.id]
      );
      isPrimaryOwner = orgRows.length > 0 || user.role === 'super_admin';
    }

    res.json({ user: { ...user, is_primary_owner: isPrimaryOwner } });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'An unexpected error occurred.' });
  }
});

module.exports = router;

/**
 * rocketlawyer.webhook.js
 *
 * Handles Rocket Lawyer events:
 * - Legacy push JSON (optional HMAC via RL_WEBHOOK_SECRET)
 * - Manual Events API pull trigger: POST { "action": "pull" }
 * - Events API envelope: { eventHandle, name, coreProperties, payload }
 *
 * Production lease activation uses the Events API pull model when RL_WEBHOOK_URL is set.
 */

const express = require('express');
const crypto  = require('crypto');
const { processWebhookEvent, pullAndProcessEvents, normalizeRlEvent } = require('../services/rocketlawyer.service');

const router = express.Router();

router.use(express.json());

function verifySignature(req) {
  const secret = process.env.RL_WEBHOOK_SECRET;
  if (!secret) return true;

  const sig = req.headers['x-rl-signature'] ?? req.headers['x-rocketsign-signature'];
  if (!sig) return false;

  const rawBody = JSON.stringify(req.body);
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

router.post('/', async (req, res) => {
  if (!verifySignature(req)) {
    console.warn('[rocket-lawyer webhook] Invalid signature — rejected');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  if (req.body?.action === 'pull') {
    try {
      const result = await pullAndProcessEvents();
      return res.status(200).json({ received: true, ...result });
    } catch (err) {
      console.error('[rocket-lawyer webhook] Pull error:', err);
      return res.status(err.statusCode ?? 500).json({ error: err.message });
    }
  }

  res.status(200).json({ received: true });

  try {
    if (req.body?.eventHandle && req.body?.name) {
      await processWebhookEvent(normalizeRlEvent(req.body));
    } else {
      await processWebhookEvent(req.body);
    }
  } catch (err) {
    console.error('[rocket-lawyer webhook] Processing error:', err);
  }
});

module.exports = router;

/**
 * Portal launch email campaign — preview + send (owner only).
 *
 * GET  /api/owner/portal-launch
 * GET  /api/owner/portal-launch/preview/:id
 * POST /api/owner/portal-launch/send  { dryRun?, messageIds? }
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const { Guards } = require('../middleware/authorize');
const {
  buildCampaignMessages,
  sendCampaign,
  renderStandalonePreviewPage,
  previewHtmlForMessage,
  resolveOrgId,
  resolveSenderBcc,
} = require('../services/portal-launch-campaign.service');

const router = express.Router();
router.use(authenticate);
router.use(Guards.ownerAndAbove);

async function getBcc(orgId) {
  try {
    return await resolveSenderBcc(orgId);
  } catch {
    return null;
  }
}

router.get('/', async (req, res) => {
  try {
    const { messages, electric } = await buildCampaignMessages();
    const orgId = await resolveOrgId();
    const bcc = orgId ? await getBcc(orgId) : null;
    res.json({
      messages: messages.map((m) => ({
        id: m.id,
        label: m.label,
        role: m.role,
        to: m.to,
        recipientName: m.recipientName,
        unitLabel: m.unitLabel,
        subject: m.subject,
      })),
      electric,
      bcc,
      previewPath: '/admin/portal-launch',
    });
  } catch (err) {
    res.status(500).json({ error: 'CAMPAIGN_LOAD_FAILED', message: err.message });
  }
});

router.get('/preview/:id', async (req, res) => {
  try {
    const html = await previewHtmlForMessage(req.params.id);
    if (!html) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Unknown campaign message id.' });
    }
    res.type('html').send(html);
  } catch (err) {
    res.status(500).json({ error: 'PREVIEW_FAILED', message: err.message });
  }
});

router.get('/gallery', async (req, res) => {
  try {
    const { messages } = await buildCampaignMessages();
    const orgId = await resolveOrgId();
    const bcc = orgId ? await getBcc(orgId) : null;
    const proto = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('x-forwarded-host') || req.get('host');
    const apiBase = `${proto}://${host}/api/owner/portal-launch`;
    res.type('html').send(renderStandalonePreviewPage({ messages, bcc, apiBase }));
  } catch (err) {
    res.status(500).type('text').send(err.message);
  }
});

router.post('/send', async (req, res) => {
  try {
    const { dryRun = false, messageIds } = req.body || {};
    const result = await sendCampaign({ messageIds, dryRun });
    res.json(result);
  } catch (err) {
    const status = err.code === 'NOT_CONNECTED' ? 503 : 500;
    res.status(status).json({ error: err.code || 'SEND_FAILED', message: err.message });
  }
});

module.exports = router;

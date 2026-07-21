/**
 * manager-playbook.routes.js — Property manager operational playbook.
 *
 * GET   /api/manager/playbook
 * PATCH /api/manager/playbook/:id
 */

const express = require('express');
const authenticate = require('../middleware/authenticate');
const { Guards } = require('../middleware/authorize');
const playbook = require('../services/manager-playbook.service');
const { buildPlaybookInsights } = require('../services/manager-playbook-insights.service');

const router = express.Router();
router.use(authenticate);
router.use(Guards.staffOnly);

function sendError(res, err) {
  const code = err.code || 'SERVER_ERROR';
  const status = { NOT_FOUND: 404, VALIDATION: 400 }[code] || 500;
  res.status(status).json({ error: code, message: err.message });
}

/** Each staff user has their own checklist rows (owner + property_manager). */
function resolvePlaybookUserId(req) {
  if (req.user.role === 'property_manager' || req.user.role === 'owner') {
    return req.user.id;
  }
  return null;
}

router.get('/playbook', async (req, res) => {
  try {
    const userId = resolvePlaybookUserId(req);
    if (!userId) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Playbook is available to owners and property managers only.',
      });
    }
    const [summary, insights] = await Promise.all([
      playbook.playbookSummary(userId),
      buildPlaybookInsights(userId, req.user.role),
    ]);
    res.json({ ...summary, insights });
  } catch (err) {
    console.error('[GET /manager/playbook]', err.message);
    sendError(res, err);
  }
});

router.patch('/playbook/:id', async (req, res) => {
  try {
    const userId = resolvePlaybookUserId(req);
    if (!userId) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Playbook is available to owners and property managers only.',
      });
    }
    const patch = {};
    if (req.body?.label != null) patch.label = String(req.body.label).trim();
    if (req.body?.notes != null) patch.notes = String(req.body.notes).trim();
    if (req.body?.mark_completed === true) patch.last_completed_at = new Date();
    if (req.body?.mark_verified === true) patch.last_verified_at = new Date();
    if (req.body?.clear_completed === true) patch.last_completed_at = null;
    if (req.body?.clear_verified === true) patch.last_verified_at = null;

    const item = await playbook.updatePlaybookItem(userId, req.params.id, patch);
    res.json({ item });
  } catch (err) {
    console.error('[PATCH /manager/playbook/:id]', err.message);
    sendError(res, err);
  }
});

module.exports = router;

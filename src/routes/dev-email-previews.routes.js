/**
 * Dev-only HTML email template gallery — never sends mail.
 */

const express = require('express');
const {
  isEmailPreviewAllowed,
  renderPreview,
  renderPreviewIndexHtml,
  renderAllPreviewsHtml,
  listTemplateKeys,
} = require('../services/email-templates');

const router = express.Router();

router.use((req, res, next) => {
  if (!isEmailPreviewAllowed()) {
    return res.status(404).json({ error: 'NOT_FOUND', message: 'Email previews are disabled in production.' });
  }
  next();
});

router.get('/', (_req, res) => {
  res.type('html').send(renderPreviewIndexHtml());
});

router.get('/all', (_req, res) => {
  res.type('html').send(renderAllPreviewsHtml());
});

router.get('/:key', (req, res) => {
  const result = renderPreview(req.params.key);
  if (!result) {
    return res.status(404).json({
      error: 'UNKNOWN_TEMPLATE',
      message: `Unknown template key: ${req.params.key}`,
      keys: listTemplateKeys(),
    });
  }
  res.type('html').send(result.html);
});

module.exports = router;

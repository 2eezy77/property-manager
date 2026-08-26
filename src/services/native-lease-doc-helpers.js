'use strict';

/**
 * Pure helpers for native lease money coalescing and document path shaping.
 * Kept pool-free so unit tests can require without DATABASE_URL.
 */

const path = require('path');
const fs = require('fs');

const DEFAULT_HOUSE_RULES = {
  smoking: false,
  pets: false,
  quietHours: '10:00pm–8:00am',
  guestNights: 7,
};

function coalesceMoney(value, fallback) {
  return value === undefined || value === null || value === '' ? fallback : value;
}

function normalizeHouseRules(houseRules) {
  return {
    ...DEFAULT_HOUSE_RULES,
    ...(houseRules || {}),
  };
}

function relativeDocumentPath(value) {
  if (!value) return null;
  if (String(value).startsWith('/documents/')) return value;
  return `/documents/${path.basename(String(value))}`;
}

function filesystemPathForDocument(value, docsDir) {
  if (!value) return null;
  if (path.isAbsolute(value) && fs.existsSync(value)) return value;
  return path.join(docsDir, path.basename(String(value)));
}

module.exports = {
  DEFAULT_HOUSE_RULES,
  coalesceMoney,
  normalizeHouseRules,
  relativeDocumentPath,
  filesystemPathForDocument,
};

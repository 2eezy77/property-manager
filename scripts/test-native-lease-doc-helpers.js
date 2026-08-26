#!/usr/bin/env node
/**
 * Native lease money coalesce + document path helpers.
 * Run: npm run test:native-lease-doc-helpers
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  coalesceMoney,
  normalizeHouseRules,
  relativeDocumentPath,
  filesystemPathForDocument,
  DEFAULT_HOUSE_RULES,
} = require('../src/services/native-lease-doc-helpers');

assert.strictEqual(coalesceMoney(undefined, 900), 900);
assert.strictEqual(coalesceMoney(null, 900), 900);
assert.strictEqual(coalesceMoney('', 900), 900);
assert.strictEqual(coalesceMoney(0, 900), 0, '0 must not fall back');
assert.strictEqual(coalesceMoney(1250, 900), 1250);

const rules = normalizeHouseRules({ pets: true });
assert.strictEqual(rules.pets, true);
assert.strictEqual(rules.smoking, DEFAULT_HOUSE_RULES.smoking);
assert.strictEqual(rules.quietHours, DEFAULT_HOUSE_RULES.quietHours);
assert.strictEqual(rules.guestNights, DEFAULT_HOUSE_RULES.guestNights);
assert.deepStrictEqual(normalizeHouseRules(null), DEFAULT_HOUSE_RULES);

assert.strictEqual(relativeDocumentPath(null), null);
assert.strictEqual(relativeDocumentPath(''), null);
assert.strictEqual(
  relativeDocumentPath('/documents/lease-abc.pdf'),
  '/documents/lease-abc.pdf'
);
assert.strictEqual(
  relativeDocumentPath('/tmp/evil/../lease-abc.pdf'),
  '/documents/lease-abc.pdf',
  'basename strips parent path segments'
);
assert.strictEqual(
  relativeDocumentPath('uploads/subdir/lease.pdf'),
  '/documents/lease.pdf',
  'relative nested paths keep basename only'
);

const docsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-lease-docs-'));
try {
  assert.strictEqual(filesystemPathForDocument(null, docsDir), null);
  assert.strictEqual(
    filesystemPathForDocument('lease-x.pdf', docsDir),
    path.join(docsDir, 'lease-x.pdf')
  );
  assert.strictEqual(
    filesystemPathForDocument('/documents/../secret/lease-x.pdf', docsDir),
    path.join(docsDir, 'lease-x.pdf'),
    'relative/doc paths resolve under docsDir via basename'
  );

  const absExisting = path.join(docsDir, 'existing.pdf');
  fs.writeFileSync(absExisting, 'pdf');
  assert.strictEqual(
    filesystemPathForDocument(absExisting, docsDir),
    absExisting,
    'existing absolute path is kept'
  );
} finally {
  fs.rmSync(docsDir, { recursive: true, force: true });
}

console.log('OK native lease doc helpers');

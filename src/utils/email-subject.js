/**
 * Gmail-safe email subjects: ASCII only, no em/en dashes or emoji.
 * Prevents mojibake (e.g. Ã¢Â€Â") when MIME Subject is not RFC 2047-encoded.
 */
function sanitizeEmailSubject(subject) {
  if (subject == null) return '';
  return String(subject)
    .replace(/\u2014/g, ' - ')
    .replace(/\u2013/g, ' - ')
    .replace(/\u2212/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { sanitizeEmailSubject };

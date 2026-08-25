/**
 * CORS / production canonical origin helpers (pure).
 */

/** Production canonical origin — always https + www (Railway issues cert on www). */
function productionCanonicalOrigin({
  clientOrigin = process.env.CLIENT_ORIGIN,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const raw = clientOrigin;
  if (!raw || nodeEnv !== 'production') return null;
  try {
    const u = new URL(raw);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return null;
    u.protocol = 'https:';
    if (!u.hostname.startsWith('www.')) u.hostname = `www.${u.hostname}`;
    return u.origin;
  } catch {
    return null;
  }
}

function corsOrigins({
  clientOrigin = process.env.CLIENT_ORIGIN,
} = {}) {
  const base = clientOrigin ?? 'http://localhost:5173';
  const set = new Set([base]);
  try {
    const u = new URL(base);
    const bare = u.hostname.replace(/^www\./, '');
    set.add(`${u.protocol}//${bare}`);
    set.add(`${u.protocol}//www.${bare}`);
    set.add(`https://${bare}`);
    set.add(`https://www.${bare}`);
  } catch { /* localhost */ }
  return set;
}

module.exports = {
  productionCanonicalOrigin,
  corsOrigins,
};

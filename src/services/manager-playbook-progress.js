/**
 * Pure manager-playbook helpers (no DB) — progress math + retired categories.
 */

/** Retired playbook categories — hide from checklist (off-app Cash App import removed). */
const HIDDEN_CATEGORIES = new Set(['cashapp_imports']);

function isHiddenPlaybookCategory(category) {
  return HIDDEN_CATEGORIES.has(category);
}

/** Progress math for checklist rows (hidden categories excluded). */
function summarizePlaybookProgress(items) {
  const rows = Array.isArray(items) ? items : [];
  const visible = rows.filter((i) => !isHiddenPlaybookCategory(i?.category));
  const total = visible.length;
  const completed = visible.filter((i) => i.last_completed_at).length;
  const verified = visible.filter((i) => i.last_verified_at).length;
  return { items: visible, total, completed, verified };
}

module.exports = {
  HIDDEN_CATEGORIES,
  isHiddenPlaybookCategory,
  summarizePlaybookProgress,
};

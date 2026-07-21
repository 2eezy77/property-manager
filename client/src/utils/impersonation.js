/** Session backup while owner views tenant portal. */
const KEY = 'pm_impersonation';

export function readImpersonation() {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeImpersonation(data) {
  sessionStorage.setItem(KEY, JSON.stringify(data));
}

export function clearImpersonation() {
  sessionStorage.removeItem(KEY);
}

export function isImpersonating() {
  return !!readImpersonation();
}

/** Staff preview — managers get history-only mode; owners see full portal. */
export function isManagerImpersonation() {
  const data = readImpersonation();
  return data?.ownerUser?.role === 'property_manager';
}

export function isStaffImpersonation() {
  return isImpersonating();
}

/**
 * Local dev auto-login — only active when Vite DEV + credentials are set in .env.local.
 * Never bundled into production (import.meta.env.DEV is false in prod builds).
 */

export const DEV_LOGIN_EMAIL = import.meta.env.VITE_DEV_LOGIN_EMAIL || '';
export const DEV_LOGIN_PASSWORD = import.meta.env.VITE_DEV_LOGIN_PASSWORD || '';
export const DEV_AUTO_LOGIN = import.meta.env.DEV && DEV_LOGIN_EMAIL && DEV_LOGIN_PASSWORD;

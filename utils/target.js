// Single source of truth for the target app URL and Vercel protection-bypass headers.
// Shared by playwright.config.js and auth/global-setup.js so both hit the target the same way.

export const BASE_URL = process.env.BASE_URL ?? 'https://notion-knockoff-mvp.vercel.app';

/** Bypass headers are sent only when the secret is set (preview deployments). */
export function bypassHeaders() {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return {};
  return {
    'x-vercel-protection-bypass': secret,
    'x-vercel-set-bypass-cookie': 'true',
  };
}

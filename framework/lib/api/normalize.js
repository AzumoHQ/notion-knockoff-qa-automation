const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d+$/;
const LONG_TOKEN = /^[0-9a-zA-Z_-]{20,}$/;

/**
 * `/pages/123e4567-...?select=*&id=eq.7` -> { origin, path: '/pages/{id}', query: ['id', 'select'] }.
 * Query values are dropped on purpose: only parameter names are kept, so no data or token is ever stored.
 */
export function endpointTemplate(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl, 'http://placeholder.invalid');
  } catch {
    return { origin: '', path: String(rawUrl), query: [] };
  }
  const segments = url.pathname.split('/').map((s) => (UUID.test(s) || NUMERIC.test(s) || (LONG_TOKEN.test(s) && /\d/.test(s)) ? '{id}' : s));
  return {
    origin: url.origin === 'http://placeholder.invalid' ? '' : url.origin,
    path: segments.join('/'),
    query: [...new Set([...url.searchParams.keys()])].sort(),
  };
}

export const endpointKey = (method, path) => `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, '{id}')}`;

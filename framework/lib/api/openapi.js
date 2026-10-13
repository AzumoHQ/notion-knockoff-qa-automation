const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/** Operations declared by an OpenAPI 3 or Swagger 2 document: [{ method, path }] with `prefix` applied. */
export function documentedEndpoints(spec, { prefix = '' } = {}) {
  if (!spec || typeof spec !== 'object' || !spec.paths) return [];
  const serverPath = spec.servers?.[0]?.url ? safePath(spec.servers[0].url) : '';
  const basePath = spec.basePath && spec.basePath !== '/' ? spec.basePath : '';
  const base = (serverPath || basePath || prefix).replace(/\/$/, '');
  const out = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) if (item?.[method]) out.push({ method: method.toUpperCase(), path: `${base}${path}` });
  }
  return out;
}

function safePath(url) {
  try {
    return new URL(url, 'http://x.invalid').pathname;
  } catch {
    return '';
  }
}

/** Well-known places an API describes itself, tried in order against each origin. */
export const OPENAPI_CANDIDATES = ['/openapi.json', '/swagger.json', '/v3/api-docs', '/api-docs', '/api/openapi.json', '/rest/v1/'];

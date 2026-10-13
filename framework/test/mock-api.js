import http from 'node:http';

/**
 * In-memory API for tests: token auth, items owned by their creator, a login endpoint and an OpenAPI document.
 * `state.expire()` invalidates every token, so the next call answers 401.
 */
export async function startMockApi() {
  const state = { items: [], tokens: new Map(), logins: 0, nextId: 1 };
  state.expire = () => state.tokens.clear();
  state.seedForeign = (name, owner = 'someone-else') => state.items.push({ id: String(state.nextId++), name, owner, createdAt: new Date().toISOString() });

  const server = http.createServer((req, res) => {
    const send = (status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(body === undefined ? '' : JSON.stringify(body));
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.method === 'POST' && req.url === '/auth/login') {
        if (body.username !== 'qa' || body.password !== 'good') return send(401, { error: 'bad credentials' });
        const token = `token-${++state.logins}`;
        state.tokens.set(token, body.username);
        return send(200, { data: { token } });
      }
      if (req.url === '/openapi.json') return send(200, { openapi: '3.0.0', paths: { '/api/items': { get: {}, post: {} }, '/api/items/{id}': { delete: {} } } });
      if (req.url === '/api/health') return send(200, { ok: true });
      const user = state.tokens.get((req.headers.authorization ?? '').replace('Bearer ', ''));
      if (!user) return send(401, { error: 'unauthorized' });
      if (req.method === 'GET' && req.url === '/api/items') return send(200, state.items.filter((i) => i.owner === user));
      if (req.method === 'POST' && req.url === '/api/items') {
        const item = { id: String(state.nextId++), name: body.name, owner: user, createdAt: new Date().toISOString() };
        state.items.push(item);
        return send(201, item);
      }
      const del = /^\/api\/items\/(\w+)$/.exec(req.url);
      if (req.method === 'DELETE' && del) {
        const index = state.items.findIndex((i) => i.id === del[1] && i.owner === user);
        if (index < 0) return send(404, { error: 'not found' });
        state.items.splice(index, 1);
        return send(204);
      }
      send(404, { error: 'no route' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, state, close: () => server.close() };
}

/** The resources definition tests use against the mock: what a project writes in api/api.config.js. */
export const itemResources = {
  item: {
    create: async (api, { name }) => ({ id: (await api.json(await api.post('/api/items', { data: { name } }), 'create item')).id }),
    remove: async (api, { id }) => {
      const res = await api.delete(`/api/items/${id}`);
      if (!res.ok() && res.status() !== 404) throw new Error(`delete item ${res.status()}`);
    },
    list: async (api) => (await api.json(await api.get('/api/items'), 'list items')).map((i) => ({ id: i.id, name: i.name, createdAt: i.createdAt })),
  },
};

export const loginConfig = (url) => ({
  baseURL: url,
  prefix: 'qa-auto-',
  auth: { mode: 'login-endpoint', url: '/auth/login', body: { username: '{username}', password: '{password}' }, tokenPath: 'data.token' },
  resources: itemResources,
});

export const mockProfiles = { default: { name: 'default', credentialsEnvPrefix: 'TEST_USER', storageStatePath: 'auth/default.storageState.json' } };
export const mockEnv = { TEST_USER_USERNAME: 'qa', TEST_USER_PASSWORD: 'good' };

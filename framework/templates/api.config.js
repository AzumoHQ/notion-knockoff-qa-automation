import { loadEnv } from '../framework/lib/env.js';

loadEnv();

// API settings shared by API tests, seeding and the sweeper. Fill `resources` from what exploration found
// (docs/api-endpoints.md lists the observed endpoints). Secrets come from the environment, never from here.
export default {
  baseURL: process.env.API_BASE_URL ?? process.env.BASE_URL,
  headers: {},
  // none | cookies | bearer-localstorage | login-endpoint (see framework/lib/api/session.js)
  auth: { mode: 'cookies', profile: 'default' },
  prefix: 'qa-auto-',
  // One entry per kind of data tests create. `remove` must treat "already gone" as success.
  // `list` returns [{ id, name, createdAt? }] visible to the QA account: it is how `npm run qa -- sweep`
  // finds leftovers of interrupted runs.
  resources: {
    // item: {
    //   create: async (api, { name }) => ({ id: (await api.json(await api.post('/api/items', { data: { name } }))).id }),
    //   remove: async (api, { id }) => { await api.delete(`/api/items/${id}`); },
    //   list: async (api, { prefix }) => (await api.json(await api.get('/api/items')))
    //     .filter((i) => i.name.startsWith(prefix))
    //     .map((i) => ({ id: i.id, name: i.name, createdAt: i.createdAt })),
    // },
  },
};

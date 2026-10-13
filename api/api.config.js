import { loadEnv } from '../framework/lib/env.js';

loadEnv();

// The app's backend is Supabase (PostgREST). The browser session token is a Supabase JWT stored in localStorage,
// and every request also needs the project's public anon key as `apikey` (SUPABASE_ANON_KEY in .env).
const headers = { apikey: process.env.SUPABASE_ANON_KEY ?? '', 'Content-Type': 'application/json' };

/** The QA account's own default workspace, named "Espacio de <username>". Roles come back upper-case (OWNER, MEMBER, GUEST). */
export async function ownedWorkspaceId(api) {
  const rows = await api.json(await api.get('/rest/v1/workspace_members?select=role,workspace:workspaces(id,name)&role=eq.OWNER'));
  const ownName = `Espacio de ${process.env.TEST_USER_USERNAME}`;
  const owned = rows.find((row) => row.workspace?.name === ownName);
  if (!owned) throw new Error('The QA account owns no default workspace');
  return owned.workspace.id;
}

// API settings shared by API tests, seeding and the sweeper. Secrets come from the environment, never from here.
export default {
  baseURL: process.env.API_BASE_URL ?? process.env.BASE_URL,
  headers,
  auth: { mode: 'bearer-localstorage', profile: 'default', keyPattern: 'auth-token$', tokenPath: 'access_token' },
  prefix: 'qa-auto-',
  resources: {
    // A root page in the QA account's own workspace. The table grants no direct UPDATE/DELETE: pages are removed with the
    // same RPCs the UI uses (archive, then delete permanently, which also removes subpages).
    page: {
      create: async (api, { name }) => {
        const workspaceId = await ownedWorkspaceId(api);
        const rows = await api.json(
          await api.post('/rest/v1/pages?select=id', {
            data: { workspace_id: workspaceId, parent_id: null, title: name, icon: null },
            headers: { Prefer: 'return=representation' },
          }),
          'create page',
        );
        return { id: rows[0]?.id ?? rows.id };
      },
      remove: async (api, { id }) => {
        await api.post('/rest/v1/rpc/archive_page', { data: { p_page_id: id } });
        await api.post('/rest/v1/rpc/delete_page_permanently', { data: { p_page_id: id } });
      },
      list: async (api, { prefix }) => {
        const workspaceId = await ownedWorkspaceId(api);
        const rows = await api.json(
          await api.get(`/rest/v1/pages?select=id,title,created_at&workspace_id=eq.${workspaceId}&title=like.${encodeURIComponent(prefix)}*`),
        );
        return rows.map((row) => ({ id: row.id, name: row.title, createdAt: row.created_at }));
      },
    },
  },
};

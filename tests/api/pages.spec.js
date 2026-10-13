import { test, expect } from '../../fixtures/api.fixture.js';
import { ApiSession } from '../../framework/lib/api/session.js';
import apiConfig, { ownedWorkspaceId } from '../../api/api.config.js';
import { PROFILES } from '../../auth/environment-profile.js';

const rpc = (api, name, data) => api.post(`/rest/v1/rpc/${name}`, { data });
const pageById = async (api, id) => api.json(await api.get(`/rest/v1/pages?select=id,title,archived_at&id=eq.${id}`));

test.describe('Pages API (Supabase PostgREST)', () => {
  // Without the public anon key and the API URL the tests cannot run: skip them instead of failing the whole run.
  test.skip(!process.env.SUPABASE_ANON_KEY || !process.env.API_BASE_URL, 'SUPABASE_ANON_KEY and API_BASE_URL are not both set');

  test('TC0019 - anonymous requests cannot read pages', async () => {
    const anonymous = await ApiSession.create({ config: { ...apiConfig, auth: { mode: 'none' } }, profiles: PROFILES });
    try {
      const response = await anonymous.get('/rest/v1/pages?select=id&limit=1');
      expect(response.status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  });

  test('TC0020 - a created page is returned with its title, workspace and no parent', async ({ api, seed }) => {
    const created = await seed.create('page');
    const workspaceId = await ownedWorkspaceId(api);
    const rows = await api.json(await api.get(`/rest/v1/pages?select=*&id=eq.${created.id}`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: created.name, workspace_id: workspaceId, parent_id: null, archived_at: null });
  });

  test('TC0021 - the title can be updated with a PATCH', async ({ api, seed }) => {
    const created = await seed.create('page');
    const response = await api.patch(`/rest/v1/pages?id=eq.${created.id}`, {
      data: { title: `${created.name}-b` },
      headers: { Prefer: 'return=representation' },
    });
    expect(response.status()).toBe(200);
    expect((await pageById(api, created.id))[0].title).toBe(`${created.name}-b`);
  });

  test('TC0022 - a direct DELETE on the table is not permitted', async ({ api, seed }) => {
    const created = await seed.create('page');
    const response = await api.delete(`/rest/v1/pages?id=eq.${created.id}`);
    expect(response.status()).toBe(403);
    expect(await pageById(api, created.id)).toHaveLength(1);
  });

  test('TC0023 - archive_page marks the page archived and hides it from search', async ({ api, seed }) => {
    const created = await seed.create('page');
    const workspaceId = await ownedWorkspaceId(api);
    const search = async () => api.json(await rpc(api, 'search_pages', { p_workspace_id: workspaceId, p_query: created.name }));
    expect((await search()).map((row) => row.id)).toContain(created.id);
    expect((await rpc(api, 'archive_page', { p_page_id: created.id })).status()).toBe(204);
    expect((await pageById(api, created.id))[0].archived_at).not.toBeNull();
    expect((await search()).map((row) => row.id)).not.toContain(created.id);
  });

  test('TC0024 - delete_page_permanently removes an archived page', async ({ api, seed }) => {
    const created = await seed.create('page');
    await rpc(api, 'archive_page', { p_page_id: created.id });
    const response = await rpc(api, 'delete_page_permanently', { p_page_id: created.id });
    expect(response.ok()).toBe(true);
    expect(await pageById(api, created.id)).toEqual([]);
  });
});

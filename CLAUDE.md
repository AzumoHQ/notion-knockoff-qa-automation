# notion-knockoff-qa-automation

E2E automation for the Notion-clone workspace app (client-rendered SPA on Vercel). Built from the
AI-Driven Automation Framework template (Playwright + JS ESM + POM + fixtures + Allure).

## Commands

- `npm run setup` — install deps + Playwright browsers
- `npm run test:smoke` — smoke suite + Allure report
- `npm test` — full suite + Allure report (opens on :3030)

## Config

- `BASE_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `TEST_USER_USERNAME`, `TEST_USER_PASSWORD` live in `.env` (gitignored; see `.env.example`).
- `utils/target.js` is the single source for baseURL and bypass headers (sent only when the secret is set).
- `auth/global-setup.js` logs in once per profile and saves `auth/<profile>.storageState.json`.

## App: Workspace (Notion-clone)

- SPA with empty initial HTML, title "Workspace". Always wait for a key element (never `networkidle` alone).
- Login: placeholders `Usuario` / `Contraseña`, button `Ingresar`; post-login URL matches `/w/<workspace-id>`.
- New page: `Nueva página` creates "Sin título" at `/w/<ws>/p/<id>`; title is a textarea labelled `Título de la página`.
- Blocks: `Agregar bloque` appends a textarea labelled `Texto` (markdown shortcuts `# - [] >`).
- Delete is two-step: `Archivar` (confirm dialog) then Papelera → `Eliminar definitivamente` (confirm dialog).
- Runs against production: every created page uses the `DATA_TEST_PREFIX` prefix and is removed in cleanup.
- Persistence is the key assertion: validate every create/edit/delete after a reload.

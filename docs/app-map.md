# App map (Explorer output)

Discovered against production with a logged-in session. SPA, title "Workspace", UI copy in Spanish.

## Routes

| Route | What it is |
|---|---|
| `/` | Splash, then login form (anonymous) or redirect to `/w/<workspace-id>` (authenticated) |
| `/w/<ws>` | Workspace home; empty state "Todavía no hay páginas" |
| `/w/<ws>/p/<page>` | Page editor |
| `/w/<ws>/trash` | Trash (Papelera) |
| `/w/<ws>/settings/members`, `/w/<ws>/settings/groups` | Members / Groups |
| `/settings`, `/profile` | Preferences / Profile |
| anything else | 404 "Página no encontrada" |

## Flows

| Flow | UI | Backend call |
|---|---|---|
| Login | `Usuario` + `Contraseña` + `Ingresar`; error "Usuario o contraseña incorrectos." | Supabase Auth |
| Logout | `Cerrar sesión` (sidebar) → back to `/` | — |
| Create page | `Nueva página` → "Sin título" at `/p/<id>` | `POST /rest/v1/pages` |
| Rename | textarea `Título de la página`; sidebar updates | `PATCH /rest/v1/pages` |
| Add block | `Agregar bloque` → textarea `Texto` | `POST/PATCH /rest/v1/blocks` |
| Block types | markdown shortcut when typing: `# ` → "Título 1", `- ` → "Lista con viñetas" (also `[]`, `>`) | `PATCH blocks` |
| Sub-page | `Agregar subpágina en <title>` (sidebar) | `POST pages` |
| Archive | `Archivar` → confirm dialog | `PATCH pages` |
| Restore / delete | Papelera → `Restaurar <title>` / `Eliminar definitivamente <title>` (+ confirm) | `rpc/delete_page_permanently` |
| Search | `Buscar` (⌘K) dialog, searches title and content | — |
| Sidebar actions | `Acciones de <title>`: Subir, Bajar, Mover a…, Archivar | — |

## Not covered yet

Share/Compartir, Move, image upload, members/groups management, preferences, profile, workspace switcher.

## Gotchas

- Sidebar is rendered several times (desktop + mobile): always `.first()` on sidebar locators.
- After logout the app shows a splash for ~2 s before the login form: use web-first assertions.
- Sidebar and trash lists load asynchronously: wait for the data before counting elements.
- The archive confirm dialog can re-mount while data refreshes: archive is retried as a whole.
- Opening a sub-page keeps a `/p/` URL: wait for the URL to *change*, not to match `/p/`.

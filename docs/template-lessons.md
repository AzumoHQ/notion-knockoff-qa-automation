# Lessons for the base template (goal: an autonomous automation framework)

Learned while building this project from `ai-driven-automation-framework-template`.

## Gaps in the template (found by running it for real)
- It is a skill plus templates, not a runnable orchestrator. Explorer, Executor, Healer, orchestrator and `ticket-loop` do not exist as code.
- Generator only turns Jira tickets into placeholder skeletons. It should generate specs from an exploration / app map.
- Healer was never exercised: every failure was a test bug, and Tier 3 (LLM) would have masked real concurrency problems.

## Fixes to apply to the template
- `.gitignore`: do not ignore `auth/` wholesale (it hides `global-setup.js`); ignore `.env*` (except `.env.example`) and `auth/*.storageState.json`.
- Credential variable names must be generic (`USERNAME` vs `EMAIL`) and `validateEnv` must match them.
- `DataProvisioner`: unique prefixed entity names (`qa-auto-<slug>-<uid>`) plus a cleanup registry.
- Ship a `target.js` (BASE_URL + conditional Vercel bypass headers) used by both config and global-setup.
- Ship `trackWrites` (wait for non-GET API calls to settle before reload) for persistence-after-reload assertions.
- Ship cleanup helpers and a global-teardown that sweeps the data prefix.
- Logout spec in its own project that depends on the main one (it can revoke the shared session).
- Ship analyst glue (`run-analyst.js`, `npm run analyze`) that reads the Playwright JSON results.
- CI template: `repository_dispatch` + `workflow_dispatch` + `schedule`, concurrency serialization, URL validation, Java for Allure, gh-pages per-run history with retention, app-repo trigger snippet.

## Pitfalls to document
- `locator.count()` does not wait for async lists; wait for the data response first.
- `waitForURL(/pattern/)` can match the current URL immediately; wait for it to change.
- Duplicated headings or sidebar entries need `.first()` (strict mode).
- Confirm dialogs can re-mount mid-click: retry the whole click sequence.
- Plain YAML scalars containing `: ` break workflows; use `run: |`.
- `repository_dispatch` only works when the workflow is on the default branch; Pages must be enabled once.
- Production testing needs a dedicated account, unique prefixed data and serialized runs.
- Secrets never go through chat.

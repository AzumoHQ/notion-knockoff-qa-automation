# Notion Knockoff QA Automation

E2E suite (Playwright + Page Object Model + Allure) for the Notion-clone workspace app deployed on Vercel.
Built from the AI-Driven Automation Framework template. Every create/edit/delete is validated **after a reload**.

## Run locally

```bash
npm run setup                 # install deps + Playwright browsers
cp .env.example .env          # then fill in the values below
npm test                      # full suite + analyst + Allure report (opens on :3030)
npm run test:smoke            # smoke only
npx playwright test --ui      # debug interactively
```

| Env var | Required | Purpose |
|---|---|---|
| `BASE_URL` | no | URL under test (default: production) |
| `TEST_USER_USERNAME` / `TEST_USER_PASSWORD` | yes | Test account (login form) |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | previews only | Sent as `x-vercel-protection-bypass` headers, only when set |
| `DATA_TEST_PREFIX` | no | Prefix of every page the tests create (default `qa-auto-`) |

Tests run against production data: each test creates uniquely-titled pages and deletes them afterwards
(archive + delete permanently). A global teardown sweeps any `qa-auto-*` leftovers from aborted runs.

## CI

`.github/workflows/e2e-vercel.yml` runs on:

- `repository_dispatch` (`vercel-deployment`), fired by the app repo after each successful Vercel deploy.
  Add `docs/app-repo-trigger.yml` to the app repo as `.github/workflows/trigger-e2e.yml` and a
  `QA_DISPATCH_TOKEN` secret (fine-grained PAT, Contents read/write on this repo).
- `workflow_dispatch` with an optional `base_url` (must be `https://*.vercel.app`).

Repo secrets: `TEST_USER_USERNAME`, `TEST_USER_PASSWORD`, `VERCEL_AUTOMATION_BYPASS_SECRET`.
Runs are serialized (they share one account on the target app).

## Reading the report

The Allure report is published to GitHub Pages: `https://azumohq.github.io/notion-knockoff-qa-automation/`
(`latest/` plus one folder per run, last 30 kept; trend history carries over between runs).
Failed runs also upload traces/screenshots/video as the `playwright-results` artifact, and
`analyst-report.json` classifies each failure (root cause, severity, flaky detection).

## Structure

`pages/` Page Objects · `fixtures/` Playwright fixtures (`workspace`, `pageFactory`) · `data/` unique test data ·
`auth/` login + teardown · `analyst/` diagnosis/flaky/report · `utils/` target config, write tracker, cleanup ·
`tests/smoke-tests`, `tests/regression` · `docs/app-map.md` app map.

## What stays manual (the non-autonomous ~20%)

- Deciding whether a failure is an app bug or a test problem (the Analyst only suggests).
- Areas not covered yet: sharing, move, image upload, members/groups, preferences, profile, workspace switcher.
- Google OAuth login (not automatable reliably) — only the username/password flow is tested.
- Rotating the test account password, creating `QA_DISPATCH_TOKEN`, enabling GitHub Pages once.
- Jira tickets and Slack notifications on failure (left out on purpose).
- Reviewing UX inconsistencies, e.g. after archiving, the app sometimes redirects and sometimes stays on the page.

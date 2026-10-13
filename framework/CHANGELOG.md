# Framework changelog

Versions follow semver. `npm run qa -- upgrade` shows the entries between your version and the new one.
"Manual step" lines are changes in project-owned files (config, fixtures, page objects) that upgrade never touches.

## 1.0.0

First versioned release of the shared core (everything under `framework/`).

- `init` scaffolds configuration, profiles, workflows and the first smoke suite; `doctor` checks their consistency.
- Test case catalog (`test-cases/*.yml` validated against `playwright --list`) and a static TCM page.
- API session, seed/cleanup fixtures, stale-data sweeper, endpoint discovery and coverage report.
- Failure diagnosis, selector healing in suggestion mode (optional LLM tier), reports on GitHub Pages with 15-day retention.
- Optional Slack/Jira notifications, visual comparison, risk-based selection and product deploy trigger, ticket drafts.

## 1.1.0

- `npm run qa -- env add NAME --secret|--variable`: register a setting the application needs (API key, backend URL). It is added
  to `.qa-framework.json`, `.env.example` and every generated workflow, and uploaded to GitHub when `gh` is available.
  Previously such settings reached `.env` but never CI.
- `npm run qa -- sync` regenerates the workflows from `.qa-framework.json`; `npm run qa -- secrets` also uploads variables.
- Diagnosis and healing reports are published as HTML pages and linked from the portal.
- No manual step: projects on 1.0.0 only need `npm run qa -- upgrade`.

## 1.1.1

- Flaky tests in the diagnosis show the first error of the failed attempts.
- No manual step.

## 1.1.2

- Healer: names are matched by shared words, containment or a close edit distance (0.7+). A long shared word no longer makes unrelated
  buttons look alike (found on a real project: a wrong suggestion, caught only by the verification re-run).
- No manual step.

## 1.1.3

- Healer: tests failing on the same locator share one verification and one hunk in `heal.patch`; the patch now applies with `git apply`
  (also for the first/last line and files without a final newline) and is published next to the healing report.
- No manual step.

## 1.1.4

- Removed templates nothing wired up: DB client, email helper, k6 load-test harness, FilterableTable and the memory seed files. They were never
  copied by `init`; add them back as `init` options if a project needs them.
- No manual step.

## 1.2.0

Review of the healer, publication and workflow permissions.

- Healer: look-alike names that mean another action are rejected ("Archivar" vs "Desarchivar", "Eliminar" vs "Eliminar para
  siempre", opposite verbs, scope words such as "todos"); a candidate whose name another locator already targets is rejected;
  proposals keep the original failure, the word-level differences and `reviewRequired`. A passing re-run is still not a fix.
- Healer patches are tied to the revision they were made for: `proposals.json` records the git revision and a hash of each
  target file, `heal.patch` starts with the revision, and `npm run qa -- heal check` reports stale suggestions (exit 1).
- Healer re-runs: exactly one test (file, line and title), its own output folder (the original failure evidence is not
  overwritten), no retries, one worker, five-minute limit with a graceful stop so test teardown still removes its data.
- Publication: only text, JSON and CSV attachments are published; screenshots only when `artifacts.screenshots` allows it
  (`auto` = private repositories); URL-encoded, JSON-escaped and base64 copies of secrets are redacted; a leak scan after
  sanitizing stops the publication when a secret is still present (fail closed).
- The daily and manual cleanup squashes the `qa-reports` history so expired reports do not stay readable in old commits.
- Visual workflow: the job that runs tests only reads; a second job, with no project code, writes the review branch.
- Product deploy trigger: the token needs only **Actions: Read and write** with `gh workflow run`; `repository_dispatch` needs
  Contents: write (the previous text said Actions: write, which GitHub does not accept for that event).
- No manual step: `npm run qa -- upgrade` regenerates the workflows. Public projects stop publishing screenshots (set `artifacts.screenshots` to `true` to keep them).

## 1.2.1

- Publish reports: when GitHub Pages is not enabled (private repository on a free plan, or not set up yet) the deploy job is skipped with a notice
  instead of failing every run; reports still reach the `qa-reports` branch.
- No manual step.

## 1.2.2

- Healer: a candidate whose name another locator already uses is `needs-review` (diff in the report, not in `heal.patch`) instead of rejected.
  Found on a real project, where "Archivar" is both the archive button and its confirmation button.
- `heal check` says plainly when a report has nothing to apply.
- No manual step.

## 1.2.3

- Healer: failures reported by `locator.waitFor` ("waiting for <locator> to be visible") are read correctly; they were reported as unsupported.
  Found on a real run.
- No manual step.

## 1.2.4

- `sweep` and `api-discover` log in again when the saved storage state is older than 30 minutes (an old file from an earlier day made them fail with
  "JWT expired"). Manual-login profiles are never re-created.
- No manual step.

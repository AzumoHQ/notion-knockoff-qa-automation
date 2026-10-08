# /manual-test [TICKET-ID]

Conduct a structured manual QA session on **{{QA_URL}}** for the given ticket, capturing screenshot evidence for each acceptance criterion.

---

## Step 0 — Load full context

Run the memory auto-discovery command and read **every** memory file listed, plus CLAUDE.md and TEST_STANDARDS.md
(or the equivalent section inside CLAUDE.md, if this project never split it out):

```bash
MEMORY_DIR="$HOME/.claude/projects/$(pwd | sed 's|/|-|g')/memory" && echo "$MEMORY_DIR" && ls "$MEMORY_DIR"
```

Do not skip any file. You need the full picture of current test state, ticket history, and QA environment details before starting.

---

## Step 1 — Collect ticket details

> **Ticket tracker integration point.** This project uses **{{TICKET_TOOL}}**. Replace this block with the real
> fetch call the first time this command is adapted for a new project — everything else in this file is
> tool-agnostic. Reference shapes:
>
> - **Jira** (Atlassian Rovo MCP):
>   ```
>   cloudId: {{JIRA_CLOUD_ID}}
>   tool: getJiraIssue(cloudId, issueIdOrKey, responseContentFormat: "markdown", fields: ["attachment"])
>   ```
> - **Linear** (Linear MCP, if connected): `getIssue(id: issueIdOrKey)`
> - **Azure DevOps**: `az boards work-item show --id <id> --org <org-url>` or the Azure DevOps MCP
> - **No tracker / pasted manually**: skip the fetch, ask the user to paste the ticket title + ACs directly

From the response extract:
1. **Summary** — ticket title
2. **Acceptance criteria** — number each one: AC1, AC2, … If ACs are implicit in the description rather than an explicit list, derive them.
3. **Context / bug description** — anything that informs how to test
4. **Attachments** — inspect the attachment list and apply this rule:
   - Filenames that follow the evidence naming pattern (`{{TICKET_PREFIX}}-XXXX_AC{n}_...`) → these are **our own output screenshots**, ignore them.
   - Any other image file (design mockup, bug recording, before/after screenshot, wireframe, etc.) → **ask the user to share it** before starting the session, since it likely contains visual context needed to understand what to test.
   - If unsure, ask.

Confirm the extracted ACs with the user before starting — tickets can be updated after the last memory snapshot.

If the tracker is unreachable, fall back to asking the user to paste the ACs or share ticket screenshots.

---

## Step 2 — Prepare evidence folder

Create a dedicated subfolder for this ticket's evidence:

```
.playwright-mcp/[TICKET-ID]/
```

- If the folder already exists with screenshots in it, ask the user whether to clear it or keep existing files before proceeding.
- All screenshots for this session go here — no other location.

---

## Step 3 — Open the QA environment

Navigate the MCP browser to `{{QA_URL}}` and log in:

- Credentials: `QA_TEST_USER_EMAIL` / `QA_TEST_USER_PASSWORD` from `.env.local` (or ask user if absent).
- Second role (when needed): `QA_ADMIN_USER_EMAIL` / `QA_ADMIN_USER_PASSWORD` → `{{ADMIN_QA_URL}}`.
- Confirm the dashboard loads before proceeding.
- **Always use the QA environment — never dev for manual testing sessions.**

### QA cold-start

If the backend has a cold-start delay (serverless/Lambda-backed apps), allow extra time on first navigation. If
you hit a fetch/timeout error, wait 10s and retry once before reporting it as a blocker.

---

## Step 4 — Verify each acceptance criterion

Work through the ACs **in order**. For each one:

### 4a — State the AC
Announce which AC you are testing and what the expected behavior is.

### 4b — Set up any needed data
If the AC requires specific data state:
- Prefer UI setup (navigate, click, fill forms).
- If UI setup is impractical **and this project has a DB utility configured**, use the QA DB (`QA_DB_*` env vars
  via `utils/db.js`'s `createDbClient('QA_')`, or a quick throwaway script). Skip this option entirely if the
  project has no direct DB access.
- **Never use the dev/prod DB for QA investigations — QA data only.**

### 4c — Execute and observe
Perform the test actions via the MCP browser. Navigate, fill, click — do exactly what a human tester would do.

### 4d — Capture screenshot
Take a screenshot and save it to `.playwright-mcp/[TICKET-ID]/` with the naming convention:

```
[TICKET-ID]_AC{n}_{short-kebab-description}.png
```

Examples:
- `PROJ-1097_AC1_save-and-submit-button-visible.png`
- `PROJ-1097_AC2_confirm-payoff-details-modal.png`

If an AC needs two shots (before + after), use `_AC{n}a` and `_AC{n}b` suffixes.

### 4e — Record the result

| Result | When to use |
|--------|-------------|
| ✅ PASS | Behavior matches the AC exactly |
| ⚠️ PARTIAL | AC partially met — document what worked and what did not |
| ❌ FAIL | Behavior does not match the AC — document actual vs expected |
| ⛔ BLOCKED | Cannot test — document the specific blocker (missing data, feature not deployed, QA environment limitation) |

Write down the result and any notes while the context is fresh.

---

## Step 5 — Produce summary table

After all ACs are tested, output this table:

```
| AC | Description (brief) | Result | Screenshot | Notes |
|----|---------------------|--------|------------|-------|
| 1  | ...                 | ✅ PASS | TICKET_AC1_....png | — |
| 2  | ...                 | ⚠️ PARTIAL | TICKET_AC2_....png | QA data: ... |
```

Also list all screenshot files saved to `.playwright-mcp/[TICKET-ID]/`.

**Automation note:** For any PASS or PARTIAL result, note whether the behavior is automatable once deployed to dev. This feeds the next automation sprint.

---

## Step 6 — Clean up

Two-part cleanup:

1. **Evidence folder** — remove any non-evidence files from `.playwright-mcp/[TICKET-ID]/` (YML, HAR, log, temp files). Keep **only** the final screenshots.

2. **Root folder** — delete all `.log` and `.yml` files that MCP drops directly in `.playwright-mcp/`:
   ```bash
   rm -f .playwright-mcp/*.log .playwright-mcp/*.yml
   ```
   These are MCP session artifacts and are never needed. Do this at the end of every session.

---

## Step 7 — Prepare ticket comment text

After the summary table, output ready-to-paste comment text for **each AC** so the user can attach it to the
ticket manually. Format:

```
AC{n} — [brief description]
[Result emoji] [PASS/PARTIAL/FAIL/BLOCKED] — [one sentence describing what was observed and on which data]. Screenshot: [filename]
```

**NEVER transition the ticket yourself in {{TICKET_TOOL}}.** The user attaches the screenshots and posts the
comments manually, then transitions the ticket themselves. Only tell the user: "Ticket is ready for you to
update — attach the screenshots and add the comments above."

---

## Step 8 — Save session context

Run `/save-session-context` to persist the session results, screenshot evidence mapping, and ticket status to memory.

---

## Key rules

- **QA only** — manual testing always on the QA environment, never dev or prod
- **One screenshot per AC** (use a/b suffixes if you genuinely need two)
- **Document QA limitations honestly** — PARTIAL/BLOCKED with a clear note is more useful than a vague PASS
- **Separate folder per ticket** — `.playwright-mcp/[TICKET-ID]/`
- **DB access** — only if this project has `utils/db.js` configured with QA DB vars; otherwise stick to UI setup
- **After manual QA, ticket will be automated** once the feature is deployed to the dev environment — mark this in the summary and in memory
- **NEVER auto-transition tickets** — always tell the user the results and let them attach screenshots + comments + transition manually

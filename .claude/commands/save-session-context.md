You are about to save everything that happened in this session to persistent context. Follow every step below without skipping anything.

## Step 1 — Read all current context files

Run this to get the memory directory:

```bash
MEMORY_DIR="$HOME/.claude/projects/$(pwd | sed 's|/|-|g')/memory" && echo "$MEMORY_DIR" && ls "$MEMORY_DIR"
```

Read every `.md` file listed, plus:

- CLAUDE.md
- TEST_STANDARDS.md — only if this project keeps it as a separate file; otherwise the same rules already live
  inside CLAUDE.md's "Test design rules" section

You need to know the current state of everything before overwriting anything.

## Step 2 — Reconstruct what happened this session

Review the full conversation history from this session and extract:

- Every file created or modified (spec files, page objects, utils, config)
- Every new test written (TC IDs, test names, which spec file, which ticket)
- Every new locator added to a page object
- Every bug, gotcha, or timing issue discovered and how it was solved
- Every DB query used (table, columns, what it resets/sets) — if this project has DB access configured
- Every decision made (why a certain approach was chosen over another)
- Any ticket status changes (started, done, blocked, parked)
- Current total test count and last TC ID
- Any new feedback rules the user gave (corrections, preferences, confirmations of approach)

## Step 3 — Update all affected files

Apply updates to whichever files need it. Rules:

### CLAUDE.md

- Add new tests to the correct section in the test inventory (smoke or regression, correct spec file)
- Add any new gotchas, locator notes, or timing behaviors discovered
- Add new page object locators if they are noteworthy
- Update test counts in spec file comments

### Memory files

For each memory file that needs updating, read it first, then write the updated version. Never delete existing content unless it is factually wrong — append or refine.

- `project_context.md` — update test count, last TC, folder structure, phase status, any new technical discoveries
- `project_next_task.md` — update ticket statuses, add new tickets if discussed, update last TC and total count
- `reference_ticket_board.md` — mark tickets done/blocked/parked, add new ticket entries if any (name this after
  the actual tracker in use, e.g. `reference_jira_board.md`, `reference_linear_board.md`)
- `project_db_access.md` — add any new tables, columns, or query patterns discovered — only if this project has DB access configured
- `project_ci_infrastructure.md` — update if CI or pipeline changes were made
- Feedback files — if the user gave new behavioral guidance (a correction or a confirmed approach), create a new feedback memory file and add it to MEMORY.md

### MEMORY.md

- Add an entry for any new memory file created
- Update the one-line description of any file whose content changed significantly

## Step 4 — Confirm

Reply with a concise summary:

- Which files were updated and what changed in each
- Current test count and last TC ID
- Next pending ticket

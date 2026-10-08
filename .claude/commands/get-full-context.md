Read everything in the steps below, in order, without skipping anything. Do not summarize or truncate — read each file in full.

## Step 1 — Project instruction files

Read these, using paths relative to the project root:

1. CLAUDE.md
2. TEST_STANDARDS.md — **only if this project keeps testing rules in a separate file.** Smaller projects fold the
   same ISTQB/naming/placement rules directly into CLAUDE.md's "Test design rules" section instead — if
   `TEST_STANDARDS.md` doesn't exist, that section of CLAUDE.md already covers it, skip the separate read.

## Step 2 — All memory files (auto-discovery)

Run the following bash command to resolve the memory directory path for whoever has this repo cloned, then list its contents:

```bash
MEMORY_DIR="$HOME/.claude/projects/$(pwd | sed 's|/|-|g')/memory" && echo "$MEMORY_DIR" && ls "$MEMORY_DIR"
```

Then read every `.md` file listed — no exceptions, no skipping. Start with `MEMORY.md`, then read the rest in the order returned. Any file added to this directory in a future session is automatically included without touching this skill.

## Step 3 — Confirm

After reading everything, reply with one short message stating: how many files were read, the current test count and last TC ID, and the next pending ticket.

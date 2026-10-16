---
name: PR Board
description: Create or update a curated PR board for the current repository — pulls live GitHub PR data, curates callouts, renders as a self-contained HTML board, and publishes to a stable secret Gist.
---

# PR Board

When the user asks to **create** or **update** the PR board for the current repository, follow this workflow exactly.

## Workflow

### 1. Identify the repo

Determine the repository from the session's git remote or by running:

```
gh repo view --json nameWithOwner
```

If no repo is found, inform the user and abort.

### 2. Pull live state

Run:

```
gh pr list --state open \
  --json number,title,isDraft,headRefName,baseRefName,reviewDecision,reviewers,statusCheckRollup,author,updatedAt
```

For PRs that need deeper curation (conflict state, review comments), also run per-PR detail queries as needed.

### 3. Curate with carry-over

If a previous snapshot exists, fetch it via the stable raw URL (no auth needed). Treat it as the board's durable memory:

- **Keep** callouts that are still true against the live data
- **Prune** ones that are stale (merged, closed, superseded)
- **Add** new ones from the live data and current-session knowledge

**Curation rules** — what earns a callout:
- Conflicts (merge conflicts, review conflicts)
- Keep-one decisions (choosing between competing PRs)
- Approved-but-still-draft
- Long waits (PRs waiting for review for an extended period)
- Merge-order risks (PRs that block others)
- Human-only steps (actions that require human intervention)

Every kept callout must be re-verified against the live data — never carried over blindly.

### 4. Build the board

Create a self-contained HTML file with:

- **Inline CSS only** — no external JS, no build step
- **Dark theme by default** with light via `prefers-color-scheme`
- **System font stack** — no Google Fonts
- **Target < 200 KB** (hard limit 1 MB)

**If you need any external assets** (icons, fonts, charting libraries, etc.), **always use a CDN link from [cdnjs](https://cdnjs.com/) or [jsdelivr](https://www.jsdelivr.com/) — never inline the content.** This keeps the artifact small and fast-loading for reviewers.

**Section floor** (in order):
1. **Header** — repo name, snapshot timestamp with age indicator, headline counts (open / ready / drafts / waiting-on-X / conflicts)
2. **Needs attention** — narrative callouts (the value of the board)
3. **Merge order** — lanes per workstream, chips with arrows, `or` / `then` for alternatives/dependencies
4. **All open PRs table** — PR number, what, position, state pill, reviewer, checks, waiting on
5. **Outstanding inputs** — what humans/externals still owe (two columns when distinct groups)
6. **Dated notes** — schedule windows, one-off facts
7. **Footer** — data provenance, "does not update itself", the ~5-minute cache-lag note

The floor is not a lock — hierarchy, typography, and indicators may be improved. A darker theme is a plus.

### 5. Publish

1. Write the HTML to `/tmp/pr-board-<slug>.html` (where `<slug>` is `pr-board-<repo>` — e.g., `pr-board-StreamOfRon/infra`)
2. Call the `publish_artifact` tool with:
   - `slug: pr-board-<repo>`
   - `file: /tmp/pr-board-<slug>.html`
   - `title: <owner>/<repo> PR board` (stable across updates — this is the adopt-match key)
   - `visibility: secret` (default, never public)

### 6. Report

Report in this order:
1. **Render link** first (the `htmlpreview.github.io` link)
2. **Gist link** alongside
3. Whether this was a **create**, **adopt**, or **update**

Include the footer copy on the board: data provenance, "does not update itself", and the ~5-minute cache-lag note.

## gh field reference

When pulling PR data, use these `gh pr list` fields:
- `number` — PR number
- `title` — PR title
- `isDraft` — draft status
- `headRefName` — source branch
- `baseRefName` — target branch
- `reviewDecision` — review decision (APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, etc.)
- `reviewers` — list of reviewers
- `statusCheckRollup` — CI check status
- `author` — PR author
- `updatedAt` — last update time

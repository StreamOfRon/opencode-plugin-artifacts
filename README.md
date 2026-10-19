# opencode-artifacts

Publish agent-built HTML to a stable, in-place-updating, browser-renderable link — powered by secret GitHub Gists.

## What it is

One OpenCode plugin, three parts:

1. **`publish_artifact` tool** — Publish any HTML file to a secret GitHub Gist and get back a stable link that updates in place.
2. **`/board` command** — Dispatches the agent to use the `pr-board` skill for generating a curated PR board.
3. **`/plan` command** — Dispatches the agent to use the `plan` skill for creating and publishing a plan or spec document for peer review.
4. **TUI footer link + toast** — Shows the latest published artifact link in the OpenCode footer, with a toast on each publish.

The GitHub Gist is the durable store; the stable SHA-less raw URL is the shared link.

## Install

Add to your `~/.config/opencode/opencode.json`:

```jsonc
{
  "plugins": [
    // ... your existing plugins ...
    "/Users/rmiller/Work/opencode-plugin-artifacts"
  ],
  "skills": [
    "/Users/rmiller/Work/opencode-plugin-artifacts/skills"
  ]
}
```

Then restart the OpenCode service:

```
opencode service restart
```

**Prerequisites:**
- `gh` CLI installed and authenticated (`gh auth status`)
- Token has the `gist` scope (`gh auth status | grep gist`)

Check with:
```
gh auth status
```

## Usage

### Publishing any HTML

Use the `publish_artifact` tool from any OpenCode session:

```
publish_artifact(slug="my-board", file="/path/to/board.html", title="My Board")
```

### Updating the PR board

In any session in your repository, say:

```
update the board
```

or use the `/board` command. The agent will:
1. Identify the repo from the git remote
2. Pull live PR data via `gh pr list`
3. Curate callouts (conflicts, decisions, blockers)
4. Render as self-contained HTML (dark theme, inline CSS)
5. Publish to a secret Gist with a stable link
6. Show the link in the TUI footer

### Link semantics

- **Render link** — `https://htmlpreview.github.io/?<rawURL>` — opens in any browser, renders the HTML
- **Gist link** — `https://gist.github.com/<owner>/<gistID>` — the source view
- **Raw link** — `https://gist.githubusercontent.com/<owner>/<gistID>/raw` — the content itself

All links use the **stable** raw form (no SHA in the URL), so the link stays the same across updates.

Secret gists = obscurity, not access control. Anyone with the link can view them.

### In-place updates

Updates use `PATCH /gists/{id}` — the URL never changes. Viewers refresh and see the new content (modulo ~5 min edge cache lag).

If the Gist was deleted out from under you, the next update recreates it and reports **created** with a loud "link changed" message.

### Cache lag note

After an update, viewers may see the previous snapshot for up to ~5 minutes (GitHub edge cache `max-age=300`). The board footer notes this.

## Troubleshooting

| Problem | Solution |
|---|---|
| `gh` missing or not logged in | `brew install gh` then `gh auth login` — ensure `gist` scope |
| API 401/403 (token expired) | Re-auth with `gh auth login` |
| API 422 (rate limit / spam) | GitHub's error message is surfaced verbatim — check rate limits |
| `htmlpreview.github.io` down | The raw URL still works — use it as a fallback |
| Multiple gist matches | You'll see a warning about ambiguity — check your existing gists |
| TUI footer shows nothing | Nothing has been published yet in this session |

## Development

### Unit tests

```
node --experimental-strip-types --test test/*.test.ts
```

### Live integration test

```
npx tsx test/live-publish.mjs
```

This creates, updates, and deletes one real secret gist on your account (`opencode-artifacts-selftest` slug). It verifies the full publish → update → delete lifecycle.

To poll for cache convergence during the live test:

```
LIVE_WAIT_CONVERGE=1 npx tsx test/live-publish.mjs
```

This polls for up to 320 seconds for the v2 marker to appear at the raw URL.

## Architecture

```
opencode-plugin-artifacts/
├── package.json
├── tsconfig.json
├── .gitignore
├── src/
│   ├── publish.ts       # Pure module: token resolution, Gist REST calls, adopt-or-create
│   ├── tool.ts          # Tool body: storage-backed mapping with graceful fallback
│   ├── index.ts         # Server plugin: publish_artifact tool + /board command
│   └── tui.tsx          # TUI plugin: footer link + toast
├── skills/
│   ├── pr-board/
│   │   └── SKILL.md     # PR Board skill — the board content workflow
│   └── plan/
│       └── SKILL.md     # Plan skill — publish plans/specs for peer review
└── test/
    ├── publish.test.ts  # Unit tests for the pure publish module
    ├── tool.test.ts     # Tool tests, including missing-storage execution
    └── live-publish.mjs # Live integration test (creates/updates/deletes real gist)
```

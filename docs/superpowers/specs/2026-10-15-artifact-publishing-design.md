# Artifact Publishing for OpenCode — Design

## Intent and the why

The user relies on Claude's artifacts feature to build and share WIP dashboards —
concretely an "IaC PR Board": a curated page showing every open PR in a working
session, where each sits in merge order, who has been asked to review, what each
is waiting on, plus narrative callouts for decisions, conflicts, and outstanding
human steps. The board is regenerated on demand ("ask Claude to update it") and
shared with teammates as a plain browser link; Claude also shows the artifact
link in its status line, which the user finds helpful.

OpenCode has no artifact equivalent: nothing renders agent-built HTML, nothing
produces a shareable, stable, updating link, and nothing shows it persistently
in the UI. This project builds that capability in two layers plus a UI surface:

1. **A general plugin** — a `publish_artifact` tool: any HTML file the agent
   builds can be published to a secret GitHub Gist and shared through a stable
   link that updates in place. This is the general capability; the PR board is
   one consumer of it.
2. **A PR board skill** — defines the board: live GitHub PR/check data plus
   curation from session context (and the board's own previous snapshot),
   rendered as a self-contained HTML page, published through the plugin.
3. **A TUI surface in the same plugin** — the latest published link is shown
   persistently in the OpenCode footer (the status-line equivalent), clickable
   where the terminal supports hyperlinks, with a toast on each publish.

**Why Gists** (user's preference, verified feasible): zero infrastructure;
anyone using OpenCode has a GitHub account; and — verified live on 2026-10-15 —
secret gists preserve the full "just works" link experience: the raw URL serves
content to anyone with the link (no login), `htmlpreview.github.io` renders it
in a browser, and in-place updates (`PATCH /gists/{id}`) keep the URL stable
across snapshots, which is exactly the artifact behavior the user relies on.
Secret (not public) is strictly better: same link UX, and the board stays out
of Gist Discover and search.

## Verified facts (evidence, not assumption)

- `gh` CLI v2.102.0 is installed on the user's machine, logged in
  (`StreamOfRon`), token scopes include `gist` (and `repo`, `workflow`,
  `read:org`). `gh auth token` yields a usable token. The OpenCode background
  service's `PATH` includes `/opt/homebrew/bin`, so the plugin can shell out to
  `gh`.
- GitHub REST gists API: `POST /gists` (create; `public` flag),
  `PATCH /gists/{gist_id}` (update files in place; URL unchanged),
  `DELETE /gists/{gist_id}`. Reading requires the `gist` scope; public gists
  are readable anonymously.
- **Raw URL forms.** The API's `raw_url` is **SHA-pinned**:
  `gist.githubusercontent.com/<user>/<gistID>/raw/<sha>/index.html`. Every
  `PATCH` mints a new SHA and the old SHA keeps serving the old content — a
  shared link built from it freezes at the snapshot it was minted in. The
  **stable** form is the SHA-less, user-prefixed URL:
  `https://gist.githubusercontent.com/<owner>/<gistID>/raw` (the userless
  `/<gistID>/raw` form 404s, so `<owner>` must come from the Gist API's
  `owner.login`, not be constructed from the gist ID). Verified live
  (2026-10-15, throwaway gists, since deleted): the stable form serves the
  **latest** content to unauthenticated readers for both secret and public
  gists; `htmlpreview.github.io` pointed at it renders (200). **All shared
  links in this design use the stable form, never the API's `raw_url`.**
- **Cache lag.** Raw responses carry `cache-control: max-age=300`; after an
  update, viewers may see the previous snapshot for up to ~5 minutes (up to
  ~10 for a browser that cached just before the update). The link is stable
  and converges; the page's footer notes the lag.
- GitHub's own docs: secret gists "aren't private" — anyone with the URL can
  view them; they are not listed in Discover and not searchable. (Obscurity,
  not access control — accepted by the user.)
- OpenCode: global plugins are auto-discovered from
  `~/.config/opencode/plugins/`; local-path plugins are configured in the
  `plugins` array of `opencode.json(c)`; `@opencode/plugin` imports in local
  plugins are resolved at runtime (no local `npm install` needed). Global
  skills are auto-discovered from `~/.config/opencode/skills/`, and additional
  local skill directories can be registered in the `skills` config array —
  a first-class discovery source, so the skill installs as a config entry
  pointing at this repo's `skills/` directory (no copy or symlink drift).
  A skill needs a `description` to be advertised; users can load one
  explicitly with `@skill-id`.
- OpenCode plugin API (V2): `Plugin.define({ id, setup(ctx) })`;
  `ctx.tool.transform(editor => editor.add({ name, description, input,
  execute }))` registers model-visible tools; `ctx.storage.get/set/remove`
  gives durable JSON storage; `ctx.command.transform(editor =>
  editor.add({ name, description, execute }))` registers slash commands whose
  `execute` receives `{ sessionID, prompt, delivery }` and can dispatch
  `ctx.session.prompt`.
- **Plugin storage is global per plugin** (a `kv` table in the local DB,
  namespaced `plugin:<id>:` — confirmed in the installed OpenCode v2.0.30
  source and on disk), shared across all sessions, projects, and worktrees.
  The slug→Gist mapping therefore survives new sessions and worktrees — this
  is what makes "update the board in any session" work — and the TUI side of
  the same plugin (same id) sees the same namespace.
- **TUI plugin API (V2)**: a package exporting `./tui` beside `.` loads both
  sides automatically. The TUI side gets `context.ui.slot` (placements
  include `prompt.footer.status` and `home.footer.status` — "add content to
  the built-in footer row without replacing it"), `context.ui.toast`,
  reactive `context.storage`, and `context.data.on/listen` for server events.
- **OpenTUI (v0.6.6) terminal links**: `link(url)(text)` adds link metadata
  to a text chunk; Solid anchor text nodes with an `href` prop create the same
  metadata; OpenTUI emits an OSC 8 hyperlink only when
  `capabilities.hyperlinks` is true (i.e. the user's terminal decides whether
  it is clickable). URLs longer than 512 UTF-8 bytes silently render as
  ordinary text. Gist and htmlpreview URLs are far under the limit.
- V2's base permission policy is `* → allow`, and the user's global config
  allows `~/.config/opencode/*`, `~/Work/*`, and `/tmp/*` — skill loading and
  the new tool will not trigger permission prompts. Consequence: the skill
  pins its temporary HTML file to `/tmp` (the macOS OS temp dir is **not** in
  the allowlist and would prompt on every publish).

## Goals

- **G1 — One-line update.** "Update the board" (or `/board`) in any OpenCode
  session → the agent re-pulls live state, re-curates, regenerates the HTML,
  updates the same Gist → the same link the team already has shows the new
  snapshot (modulo the ~5-minute cache lag, noted on the page).
- **G2 — Link just works.** The shared link opens in any browser, no login, no
  setup, and renders (not source).
- **G3 — Genuinely general layer.** The plugin publishes any slug + any HTML
  file. Nothing in it knows about PRs. The board is a skill on top.
- **G4 — Curated, not dumped.** The board's value is the curation: narrative
  callouts for decisions/conflicts/blockers, dependency lanes, state pills,
  "waiting on". The user's Claude artifact is the **inspiration, not the spec**
  — the builder may improve on its format (user's explicit mandate). A darker
  theme is a plus.
- **G5 — Zero infrastructure.** No servers, no extra accounts, no repos beyond
  the user's existing GitHub account. Gists only.
- **G6 — Always visible in the TUI.** The latest published link sits in the
  OpenCode footer (status-line equivalent), clickable where the terminal
  supports hyperlinks; a toast confirms each publish.

## Non-goals

- No live/polling updates. The board is an on-demand snapshot, like the
  artifact; the page states its snapshot time and that it does not update
  itself.
- No TUI *panel* with board content. The TUI surface is a link + toast only;
  the dashboard itself lives in the browser. (A full terminal panel could
  come later as a separate project.)
- No viewer-side interaction. The page is read-only for teammates.
- No access control. Secret gists are obscurity; "teammates" = "anyone with
  the link". The user accepts this.
- GitHub only. No GitLab/other VCS.
- One HTML file per slug in v1. (The Gist mechanism supports more files; the
  tool surface stays single-file.)

## Anti-goals (failure even if it "works")

- **The link changing on update.** Updates must be in-place `PATCH`, never
  delete-and-recreate. Recreation is allowed only when the Gist no longer
  exists or the mapping was lost (see failure modes), and must be loudly
  reported.
- **Board content becoming discoverable.** Gists are secret by default;
  public is an explicit opt-in flag, never the default.
- **Publishing without user intent.** The tool is invoked by the agent only
  within the skill flow (user asked for a board). No auto-publish on session
  events.
- **Failing cryptically.** Missing `gh`, bad token, API errors → the agent
  surfaces a clear remediation, not a stack trace.
- **Footer clutter when nothing is published.** The TUI footer renders
  nothing until an artifact exists for the current context.

## Constraints

- The plugin runs on the user's machine (OpenCode's background service);
  shelling out to `gh` is acceptable and preferred — it reuses the user's
  existing authentication.
- The HTML must be **self-contained**: inline CSS, no build step, no external
  JS. Small — well under the API's 1 MB per-file truncation threshold; target
  < 200 KB. (The reference artifact is ~19 KB with a Google Fonts link; the
  builder should inline a system font stack instead — builder's call.)
- The rendered link depends on a third party (`htmlpreview.github.io`). The
  design must degrade gracefully: the Gist URL and raw URL always work; the
  render URL is a convenience. The agent reports the render link first and
  the Gist link alongside.
- The board skill must work in **any repo** the user is working in (derive
  the repo from the session's location; query it via `gh`), not just the IaC
  repo.

## Architecture

### Layer 1 — plugin `opencode-artifacts` (general)

Lives in this repo. Installed globally. One package, two entry points:

```
opencode-plugin-artifacts/
├── package.json          # name: opencode-artifacts; exports "." and "./tui"
├── src/
│   ├── index.ts          # server plugin: publish_artifact tool + /board command
│   └── tui.tsx           # TUI plugin: footer link + toast
├── skills/
│   └── pr-board/
│       └── SKILL.md
└── README.md
```

**Tool: `publish_artifact`**

Input schema:

| field | type | default | meaning |
|---|---|---|---|
| `slug` | string | — | stable identity of the artifact, e.g. `pr-board-infrastructure-as-code` |
| `file` | string | — | path to the HTML file to publish |
| `title` | string | the slug | Gist description |
| `visibility` | `"secret" \| "public"` | `"secret"` | Gist visibility |

Behavior:

1. Resolve a GitHub token: `gh auth token` (shelled out); fall back to
   `GH_TOKEN` / `GITHUB_TOKEN` env vars. Neither available → return an error
   with remediation text ("install gh: `brew install gh`; then
   `gh auth login` — the token needs the `gist` scope").
2. Read the file. (Missing/unreadable → clear error.)
3. Look up `ctx.storage` key `artifact:<slug>` → `{ gistID, owner, url }`.
   - **Present** → `PATCH /gists/{gistID}` with `{ files: { "index.html":
     { content } } }`. A 404 means the Gist was deleted out from under us:
     recreate via POST and **report that the link changed**.
   - **Absent** → **adopt-or-create** (user's decision): list the user's
     gists (`GET /gists`) and match on `description === title`. A match
     means the Gist is alive but the mapping was lost (new machine, wiped
     data dir): adopt its `id` and `owner.login` into storage, then update
     via PATCH — the team's pinned link keeps working. No match → `POST
     /gists` with `{ description: title, files: { "index.html": { content }
     }, public: visibility === "public" }`. The report says **adopted** or
     **created** so the agent can tell the user.
4. Save the mapping back to storage.
5. Return `{ created: boolean, adopted: boolean, gistURL, rawURL, renderURL }`
   where:
   - `rawURL = https://gist.githubusercontent.com/<owner>/<gistID>/raw` —
     the **stable** form; `<owner>` from the API response's `owner.login`.
     Never the API's SHA-pinned `raw_url` (it freezes at the minted snapshot).
   - `renderURL = https://htmlpreview.github.io/?<rawURL>`

**Command: `/board`** (my call, flagged for the user)

A thin shim in the plugin that dispatches a prompt telling the agent to use
the `pr-board` skill for the current repo. It keeps the plugin ~90% general;
if the user wants it strictly general, it is a ten-line deletion.

**TUI side (`./tui`)**

Same plugin id, so it shares the `plugin:<id>:` storage namespace the server
side writes:

- Renders the latest published link in `prompt.footer.status` (session view)
  and `home.footer.status` (home view) — the status-line equivalent. Nothing
  renders while no mapping exists.
- The link is an OSC 8 terminal hyperlink (Solid `href`), clickable in
  terminals with `capabilities.hyperlinks`; plain text elsewhere.
- A toast on publish: "Board updated — <link>".
- **Builder to verify:** the exact reactivity path — whether the TUI's
  reactive storage observes server-side writes directly, or whether the TUI
  must re-read storage on events (`context.data.listen`) or on a slow poll.
  Any of the three is acceptable; the footer must simply converge within a
  few seconds of a publish.

**package.json** declares `@opencode/plugin` as a dependency (plus OpenTUI
peers for the TUI side) for future npm/Git distribution
(`opencode plugin add github:<user>/<repo>`); local-path installation works
without installing it because OpenCode resolves the imports at runtime.

### Layer 2 — skill `pr-board`

Lives in this repo at `skills/pr-board/SKILL.md`; installed via the `skills`
config array pointing at the repo's `skills/` directory.

Frontmatter: `name: PR Board`; a `description` tuned to be advertised when
the user asks to create or **update** the board (auto-invoke on).

Workflow the skill prescribes:

1. **Identify the repo** from the session's location (git remote /
   `gh repo view --json nameWithOwner`).
2. **Pull live state**: `gh pr list --state open --json
   number,title,isDraft,headRefName,baseRefName,reviewDecision,reviewers,
   statusCheckRollup,author,updatedAt`, plus per-PR detail where the curation
   needs it (e.g. conflict state, review comments).
3. **Curate with carry-over** (user's decision): if a previous snapshot
   exists (fetch it via the stable raw URL — no auth needed), treat it as the
   board's durable memory: **keep** callouts that are still true against the
   live data, **prune** ones that are stale (merged, closed, superseded),
   **add** new ones from the live data and whatever the current session
   knows. A first run with no previous snapshot curates purely from session
   context. The skill's curation rules name what earns a callout (conflicts,
   keep-one decisions, approved-but-still-draft, long waits, order risks,
   human-only steps) and require that every kept callout be re-verified
   against the live data — never carried over blindly.
4. **Build the board** — self-contained HTML, dark theme by default (light
   via `prefers-color-scheme`), section floor:
   - Header: repo · snapshot timestamp (with age visible at a glance) ·
     headline counts (open / ready / drafts / waiting-on-X / conflicts)
   - **Needs attention**: a few narrative callouts — the value of the board
   - **Merge order**: lanes per workstream; chips with arrows; `or` for
     alternatives, `then` for dependencies
   - **All open PRs** table: PR · what · position · state pill · reviewer ·
     checks · waiting on
   - **Outstanding inputs**: what humans/externals still owe (two columns
     when there are distinct groups)
   - **Dated notes**: schedule windows, one-off facts
   - Footer: data provenance, snapshot semantics ("does not update itself"),
     and a note that a refresh may show the previous snapshot for a few
     minutes after an update (GitHub edge cache)

   The floor is not a lock: the builder may improve hierarchy, typography,
   and indicators (e.g. snapshot age), and may drop or reorder sections that
   earn their place less — within the dark-theme preference.
5. **Publish**: write the HTML to a temporary file **in `/tmp`** (in the
   user's permission allowlist; the OS temp dir would prompt); call
   `publish_artifact` with `slug: pr-board-<repo>` (one stable board per repo
   — my call; prevents a second repo's board overwriting the first),
   `title: <owner>/<repo> PR board` (the title doubles as the adopt-match
   key, so it must stay stable across updates).
6. **Report**: render link first, Gist link alongside, and whether this was
   a create, an adopt, or an update.

### Install (one-time, user side)

Global config `~/.config/opencode/opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/Users/rmiller/Work/opencode-plugin-artifacts"],
  "skills":  ["/Users/rmiller/Work/opencode-plugin-artifacts/skills"]
}
```

- If the user later pushes the repo to GitHub, `opencode plugin add
  github:<user>/<repo>` replaces the plugin path entry — user's call, noted
  in README.
- **Prerequisite**: `gh` installed and `gh auth login` with the `gist` scope
  (verified true on this machine).

## Failure modes and behavior

| situation | behavior |
|---|---|
| `gh` missing / not logged in | tool returns remediation text; agent relays it, does not retry |
| API 401/403 (token expired / scope) | same remediation class, stated plainly |
| API 422 (rate/spam) | surface GitHub's message verbatim |
| `htmlpreview.github.io` unreachable | page still works via the raw URL; agent reports both links, render first |
| Gist deleted out from under us | next update recreates; agent **loudly** states the link changed |
| Mapping lost but Gist alive (new machine / wiped data dir) | adopt-or-create: match on the board title, adopt, update in place; the pinned link keeps working; report **adopted** |
| Viewer refreshes right after an update | may see the previous snapshot for up to ~5–10 minutes (edge cache); the page footer says so |

## Left to the builder

- The board's concrete HTML/CSS design (dark-first theme, typography, pills,
  lanes, age indicator) — inspired by the reference artifact, not cloned.
- Exact tool input schema details, error-message wording, storage key format
  (within the constraints above), and the adopt-match edge cases (multiple
  matches, none, title drift).
- The TUI footer's reactivity path (direct storage observation vs event
  re-read vs slow poll) — verify against the installed OpenCode; any path
  that converges within a few seconds is acceptable.
- The skill's wording: curation rules (including carry-over re-verification),
  section floor, `gh` field list.
- README: install, usage, link semantics, the htmlpreview dependency and its
  graceful degradation.
- Whether the `/board` shim ships (default: yes).

## Reference

- The user's current Claude artifact, saved copy: `~/Downloads/IaC PR Board.html`
  (format inspiration: header counts, needs-attention, merge-order lanes, PR
  table, outstanding-inputs columns, dated notes; light+dark theming).
- OpenCode plugin docs: `opencode.ai/v2/docs/build/plugins` (and
  `/build/plugins/cli` for the TUI side)
- OpenCode skills docs: `opencode.ai/v2/docs/skills`
- OpenTUI docs (v0.6.6): `opentui.com/docs` — "Text and terminal cells →
  Add terminal links" for OSC 8 hyperlinks
- GitHub REST gists: `docs.github.com/en/rest/gists/gists`
- Live verification of secret-gist raw + htmlpreview behavior, raw URL forms,
  and cache headers (2026-10-15/16, this session; throwaway gists deleted).

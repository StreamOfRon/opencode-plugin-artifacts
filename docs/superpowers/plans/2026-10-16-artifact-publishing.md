# Artifact Publishing for OpenCode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An OpenCode plugin that publishes agent-built HTML to a secret GitHub Gist as a stable, in-place-updating, browser-renderable link — plus a `pr-board` skill and a TUI footer link.

**Architecture:** One package, three parts: a pure `src/publish.ts` module (token resolution, URL construction, Gist REST calls, adopt-or-create) wrapped by a thin server plugin (`src/index.ts`: `publish_artifact` tool + `/board` command) and a TUI plugin (`src/tui.tsx`: footer link + toast). A `pr-board` skill (markdown) drives the board content. The Gist is the artifact's durable store; the stable SHA-less raw URL is the shared link; plugin storage holds the slug→Gist mapping.

**Tech Stack:** TypeScript run by Node v22.23.2 native type stripping (no transpiler, no runtime deps beyond `@opencode/plugin`, which OpenCode resolves at runtime); `node:test` for unit tests; `@opentui/solid` + `solid-js` as peer deps for the TUI side; GitHub REST API via global `fetch`; `gh` CLI (v2.102.0, `gist` scope, on the service's PATH) for auth.

**Spec:** `docs/superpowers/specs/2026-10-15-artifact-publishing-design.md`

## Global Constraints

- Gists are **secret** by default; `public` is an explicit opt-in input, never the default.
- All shared links use the **stable** raw form `https://gist.githubusercontent.com/<owner>/<gistID>/raw` — never the API's SHA-pinned `raw_url` (it freezes at the minted snapshot). `<owner>` comes from the API response's `owner.login`, never constructed from the gist ID.
- The Gist file is always `index.html`. Published HTML is self-contained (inline CSS, no external JS, no build step), target < 200 KB; hard limit 1 MB (API truncation).
- The board's temporary HTML file is written to `/tmp` (in the user's permission allowlist; the OS temp dir would prompt on every publish).
- Board slug: `pr-board-<repo>`; board title: `<owner>/<repo> PR board` — the title is stable across updates and doubles as the adopt-match key.
- Token resolution: `gh auth token` first; then `GH_TOKEN` / `GITHUB_TOKEN` env; neither → error carrying the remediation text `install gh: brew install gh; then gh auth login — the token needs the gist scope`; never retry on auth failure.
- Plugin id: `opencode-artifacts` (storage namespace `plugin:opencode-artifacts:`). Storage keys: `artifact:<slug>` → `{ gistID, owner, url }`; `lastPublished` → `{ slug, url, renderURL, at }` (the TUI's toast trigger).
- The TUI footer renders nothing until a `lastPublished` value exists; toasts on publish; converges within a few seconds.
- No auto-publish outside the skill flow; the tool is invoked by the agent only when the user asked for a board.
- Unit tests run with `node --test` (Node v22.23.2 strips types natively; no test framework dependency).
- The global config `~/.config/opencode/opencode.json` is **merged, never rewritten**: it already contains `formatter`, `plugins` (3 entries), `default_agent`, `agents`, `commands`, `mcp`, `permissions`, `providers`, `experimental`. If the user's config is under `opencode_sync` management, mention the new entries so they can be pushed to the sync repo.

## Review Focus

1. **A link built from the API's SHA-pinned `raw_url`** → the team's bookmarked link silently freezes at snapshot one (it still renders, so it fails silently). → Task 1 tests pin `stableRawURL`'s exact form; Task 2's live test asserts the served URL is the stable form.
2. **`gh` missing or logged out** (fresh machine) → the user gets the remediation text, not a stack trace. → Task 1 tests (stubbed spawn failure / no env vars).
3. **GitHub API 401/403** (token expired, scope lost) → same remediation class, plain language, no retry loop. → Task 1 tests (stubbed 401 and 403).
4. **Gist deleted out from under us** → the update 404s → recreate via POST and report **created** with a loud "link changed"; never crash, never keep a dead mapping. → Task 1 test (stubbed 404 on PATCH → recreate).
5. **A viewer refreshes right after an update** → may see the previous snapshot for up to ~5–10 minutes (edge cache `max-age=300`) → the board footer must say so, or the team thinks the update didn't land. → Task 4 footer copy; README documents it.

---

### Task 1: Pure publish module + unit tests

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `src/publish.ts`
- Test: `test/publish.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; no OpenCode imports)
- Produces (exact names — later tasks import these):
  - `class PublishError extends Error` — field `hint?: string` (remediation text)
  - `class AuthError extends PublishError` — field `code = "auth"`
  - `class GistDeletedError extends PublishError` — field `code = "deleted"`
  - `type GistRef = { gistID: string; owner: string; url: string }`
  - `type PublishResult = { created: boolean; adopted: boolean; warning?: string; ref: GistRef; gistURL: string; rawURL: string; renderURL: string }`
  - `resolveToken(env?: NodeJS.ProcessEnv, exec?: (cmd: string[]) => Promise<{ ok: boolean; stdout: string }>): Promise<string>`
  - `stableRawURL(owner: string, gistID: string): string`
  - `renderURL(rawURL: string): string`
  - `gistURL(owner: string, gistID: string): string`
  - `createGist(token: string, input: { title: string; content: string; visibility: "secret" | "public" }, fetchImpl?: typeof fetch): Promise<GistRef>`
  - `updateGist(token: string, gistID: string, content: string, fetchImpl?: typeof fetch): Promise<void>`
  - `listGists(token: string, fetchImpl?: typeof fetch): Promise<Array<{ id: string; owner: string; description: string | null }>>`
  - `publishArtifact(input: { token: string; slug: string; file: string; title: string; visibility: "secret" | "public"; existing?: GistRef }, fetchImpl?: typeof fetch): Promise<PublishResult>`

Behavior pinned by the spec: `updateGist` throws `GistDeletedError` on HTTP 404 and `AuthError` on 401/403; `createGist` throws `AuthError` on 401/403; any other non-2xx response from either call throws `PublishError` carrying GitHub's error message verbatim (422 rate/spam, 5xx — surfaced, never swallowed); `publishArtifact` with `existing` set calls `updateGist`, and on `GistDeletedError` recreates via `createGist` (`created: true`); with no `existing` it lists gists and matches `description === title` — exactly one match → adopt (`adopted: true`, then update), zero or more-than-one → create fresh (more-than-one also sets `warning` naming the ambiguity and never adopts). All three network functions send `Authorization: Bearer <token>` and `Accept: application/vnd.github+json` to `https://api.github.com`.

- [ ] **Step 1: Scaffold the package**

Create `package.json`:

```json
{
  "name": "opencode-artifacts",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./tui": "./src/tui.tsx"
  },
  "dependencies": {
    "@opencode/plugin": "latest"
  },
  "peerDependencies": {
    "@opentui/core": ">=0.5.8",
    "@opentui/solid": ">=0.5.8",
    "solid-js": ">=1.9.0"
  },
  "devDependencies": {
    "@types/node": "^22"
  }
}
```

(Shape per the OpenCode CLI plugin guide; `@opencode/plugin` is resolved by OpenCode at runtime for local plugins, and `npm install` is only needed for editor types.) Create `tsconfig.json` (`target: es2022`, `module: esnext`, `moduleResolution: bundler`, `strict: true`, `types: ["node"]`, include `src`, `test`) and `.gitignore` (`node_modules/`).

- [ ] **Step 2: Write the failing tests**

Create `test/publish.test.ts` using `node:test` + `node:assert/strict`. Stub `fetchImpl` with a recording fake; stub `exec` for token tests. Tests, with the spec's exact values:

1. `stableRawURL("octo", "abc123")` returns exactly `https://gist.githubusercontent.com/octo/abc123/raw` — and assert the result does **not** match `/\/raw\/[0-9a-f]{40}$/` (the SHA-pinned anti-goal).
2. `renderURL("https://gist.githubusercontent.com/octo/abc123/raw")` returns exactly `https://htmlpreview.github.io/?https://gist.githubusercontent.com/octo/abc123/raw`.
3. `gistURL("octo", "abc123")` returns exactly `https://gist.github.com/octo/abc123`.
4. `resolveToken`: `exec` resolving `{ ok: true, stdout: "gho_tok\n" }` → `"gho_tok"`; `exec` rejecting (gh missing) with `env = { GH_TOKEN: "env_tok" }` → `"env_tok"`; `exec` rejecting with `env = {}` → rejects with `PublishError` whose message contains `brew install gh` and `gist scope`.
5. `createGist`: fake fetch records the request — assert URL `https://api.github.com/gists`, method `POST`, header `authorization: Bearer tok`, and body deep-equals `{ description: "T", files: { "index.html": { content: "C" } }, public: false }` for `visibility: "secret"` (and `public: true` for `"public"`); fake responds `{ id: "g1", owner: { login: "octo" }, html_url: "https://gist.github.com/octo/g1" }` → resolves to `{ gistID: "g1", owner: "octo", url: "https://gist.github.com/octo/g1" }`.
6. `updateGist`: 200 → resolves; 404 → rejects `GistDeletedError`; 401 → rejects `AuthError` (403 too); the PATCH body deep-equals `{ files: { "index.html": { content: "C" } } }`.
7. `publishArtifact` happy path: `existing` set, fake fetch returns 200 for PATCH → result `{ created: false, adopted: false, ref, gistURL, rawURL, renderURL }` where `rawURL === stableRawURL(ref.owner, ref.gistID)` and `renderURL === renderURL(rawURL)` (stable form, not SHA-pinned).
8. `publishArtifact` existing-but-deleted: PATCH → 404, then POST → 201 → `{ created: true, adopted: false }` with the new ref.
9. `publishArtifact` no existing, one match: GET `/gists` → one gist with `description === title` → adopt, then PATCH → `{ created: false, adopted: true }`.
10. `publishArtifact` no existing, zero matches → `{ created: true, adopted: false }`, no `warning`.
11. `publishArtifact` no existing, two matches → `{ created: true, adopted: false }` with a `warning` mentioning the title (never adopts).
12. `publishArtifact` with a missing `file` → rejects `PublishError` naming the path.
13. `createGist` / `updateGist` on HTTP 422 (and 500) → reject with `PublishError` whose message contains GitHub's error body verbatim (surfaced, not swallowed).

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/publish.test.ts`
Expected: FAIL — `Cannot find module '../src/publish.ts'`

- [ ] **Step 4: Implement `src/publish.ts`**

One function per signature above. Approach notes: `resolveToken` shells out via the injected `exec` (default: `child_process.spawn` of `gh auth token`, resolving `ok` from exit code 0 and `stdout`); URL builders are one-line template strings; `createGist`/`updateGist`/`listGists` are thin `fetchImpl` wrappers that throw `AuthError` on 401/403 (with the spec's remediation `hint`) and `GistDeletedError` on 404 (update only); `publishArtifact` reads the file (`node:fs/promises readFile`, missing → `PublishError`), then runs the adopt-or-create decision above and assembles `PublishResult` from the ref via the three URL builders.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/publish.test.ts`
Expected: PASS, 13 tests, 0 failures

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore src/publish.ts test/publish.test.ts
git commit -m "feat: pure gist publish module with unit tests"
```

---

### Task 2: Server plugin glue + live integration

**Files:**
- Create: `src/index.ts`
- Create: `test/live-publish.mjs`
- Modify: `~/.config/opencode/opencode.json` (merge — see Step 3)

**Interfaces:**
- Consumes: `resolveToken`, `publishArtifact`, `GistRef`, `PublishResult` from `src/publish.ts` (Task 1)
- Produces: default export `Plugin.define({ id: "opencode-artifacts", setup })` from `@opencode/plugin`; registers tool `publish_artifact` and command `board`; writes storage keys `artifact:<slug>` and `lastPublished`

- [ ] **Step 1: Implement `src/index.ts`**

`Plugin.define({ id: "opencode-artifacts", setup(ctx) })` with two registrations:

- `ctx.tool.transform(editor => editor.add({...}))` — `name: "publish_artifact"`, a description saying it publishes an HTML file to a stable, in-place-updating secret Gist and returns the links; `input` JSON schema: `{ type: "object", properties: { slug: { type: "string" }, file: { type: "string" }, title: { type: "string" }, visibility: { type: "string", enum: ["secret", "public"] } }, required: ["slug", "file"], additionalProperties: false }`.
  `execute`: resolve the token (`resolveToken()` — let `AuthError`/`PublishError` propagate); read `existing` from `ctx.storage.get(\`artifact:${slug}\`)`; call `publishArtifact({ token, slug, file, title: input.title ?? slug, visibility: input.visibility ?? "secret", existing })`; on success `await ctx.storage.set(\`artifact:${slug}\`, result.ref)` and `await ctx.storage.set("lastPublished", { slug, url: result.rawURL, renderURL: result.renderURL, at: new Date().toISOString() })`; return `{ content: \`Published <slug> (<created|adopted|updated>) — render: <renderURL>\nGist: <gistURL>\nRaw: <rawURL>[ + warning line if result.warning] \nNote: viewers may see the previous snapshot for up to ~5 minutes after an update (GitHub edge cache).\` }`.
- `ctx.command.transform(editor => editor.add({ name: "board", description: "Update the PR board for the current repo", execute }))` — `execute` follows the documented `CommandInvocation` shape: `async ({ sessionID, prompt, delivery }) => { await ctx.session.prompt({ ...prompt, sessionID, text: "Update the PR board for the current repository. Use the pr-board skill.", delivery }) }`.

- [ ] **Step 2: Verify the unit suite still passes**

Run: `node --test test/publish.test.ts`
Expected: PASS (13 tests) — the glue adds no unit tests; it is verified live below.

- [ ] **Step 3: Merge the global config and restart the service**

In `~/.config/opencode/opencode.json` (preserve every existing field): append `"/Users/rmiller/Work/opencode-plugin-artifacts"` to the existing `plugins` array, and add a new top-level `"skills": ["/Users/rmiller/Work/opencode-plugin-artifacts/skills"]`. Then:

Run: `opencode service restart && opencode plugin list`
Expected: the plugin list includes `opencode-artifacts` (local path source), loaded without error. If the user's config is under `opencode_sync`, tell them the two new entries should be pushed to the sync repo.

- [ ] **Step 4: Write the live integration test**

Create `test/live-publish.mjs` (plain JS — it imports the TS module; run with `node`). It exercises the real GitHub API with a throwaway gist and cleans up:

1. `const { resolveToken, publishArtifact } = await import("../src/publish.ts")`; `token = await resolveToken()`.
2. Write `/tmp/opencode-artifacts-selftest.html` containing marker `v1-<timestamp>`; call `publishArtifact({ token, slug: "opencode-artifacts-selftest", file, title: "opencode-artifacts self-test (delete me)", visibility: "secret" })` → assert `created === true`; assert `result.rawURL === "https://gist.githubusercontent.com/" + result.ref.owner + "/" + result.ref.gistID + "/raw"` (stable form, exact).
3. `fetch(result.rawURL)` → 200. `fetch("https://api.github.com/gists/" + id, { Authorization })` → the `files["index.html"].content` contains the v1 marker (API reads are fresh; the raw edge cache may lag — do not assert raw freshness here).
4. Rewrite the file with marker `v2`; call again passing `existing: result.ref` → assert `created === false`; API GET now shows v2.
5. `fetch(result.rawURL)` → 200 (content may still be v1 within the 5-minute cache window — assert status only; if env `LIVE_WAIT_CONVERGE=1`, poll up to 320 s for v2 and assert convergence).
6. `fetch(result.renderURL)` → 200.
7. Cleanup: `gh gist delete <id> --yes`; remove the temp file. Any failed assertion: print which step, skip cleanup only on user instruction (default: always clean up, then exit non-zero).

- [ ] **Step 5: Run the live test**

Run: `node test/live-publish.mjs`
Expected: all assertions pass; the self-test gist is deleted; exit 0. (This creates, updates, and deletes one real secret gist on the user's account — the agreed side-effect budget.)

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/live-publish.mjs
git commit -m "feat: publish_artifact tool, /board command, live gist integration test"
```

---

### Task 3: TUI footer link + toast

**Files:**
- Create: `src/tui.tsx`

**Interfaces:**
- Consumes: storage keys `lastPublished` (`{ slug, url, renderURL, at }`) written by the server side — same plugin id, so the same `plugin:opencode-artifacts:` namespace
- Produces: default export `Plugin.define({ id: "opencode-artifacts", setup })` from `@opencode/plugin/tui`

Pinned decisions: the footer reads the durable `lastPublished` value into a reactive store; refreshes are driven by `context.data.listen` (re-read on any server event, debounced ~1 s) **plus** a 5 s interval backstop — this converges within a few seconds regardless of whether the TUI's reactive storage directly observes server-side writes (the one mechanism the spec leaves to verification; the builder checks, and if direct observation works the event/interval machinery is harmless redundancy). A toast fires only when the `at` timestamp changes.

- [ ] **Step 1: Implement `src/tui.tsx`**

`setup(context)`:

- `const [latest, setLatest] = context.storage.store("lastPublished", { initial: null })` — the render source; `refresh()` re-reads the durable value and calls `setLatest` when it changed (compare `at`); on change also `context.ui.toast.show({ title: "Artifact published", message: <renderURL>, variant: "success" })` (suppress the toast on the very first read at startup).
- Register both footer slots: `context.ui.slot({ append: "prompt.footer.status", render: () => <LatestLink latest={latest} /> })` and the same for `home.footer.status`. `LatestLink` renders `null` when `latest` is null (anti-goal: no clutter); otherwise a single `<text>` showing the slug label with the render URL as an OSC 8 hyperlink — verify against the pinned `@opentui/solid` version that `<text>` accepts `href` (OpenTUI v0.6.6 docs: "React and Solid anchor text nodes with an `href` prop create the same terminal link metadata"); if it does not, build the chunk with the core `link(url)(text)` helper instead. Clickability is automatic per `capabilities.hyperlinks`; no special handling.
- Drivers: `const stop = context.data.listen(() => { debouncedRefresh() })` and `const timer = setInterval(refresh, 5000)`; return `() => { stop(); clearInterval(timer) }`.

- [ ] **Step 2: Restart and verify in the TUI (human-in-loop — the user is present)**

Run: `opencode service restart`, then open the TUI in this repo.
Expected: the footer status shows the self-test link left in storage by Task 2 (proves the render path); it is a clickable OSC 8 link in a hyperlink-capable terminal or plain text otherwise — report which. Then run `node test/live-publish.mjs` again in another terminal: within a few seconds the TUI shows the toast "Artifact published" and the footer link updates to the new gist. Clean up the new self-test gist (`gh gist delete <id> --yes`).

- [ ] **Step 3: Commit**

```bash
git add src/tui.tsx
git commit -m "feat: TUI footer link and publish toast"
```

---

### Task 4: The `pr-board` skill

**Files:**
- Create: `skills/pr-board/SKILL.md`

**Interfaces:**
- Consumes: tool `publish_artifact` (Task 2); `gh` CLI with `repo` scope for data
- Produces: skill id `pr-board` (path-derived), advertised via its `description`

The skill is prose the agent follows. Pinned values it must carry: frontmatter `name: PR Board` and a `description` tuned to be advertised when the user asks to create or **update** the PR board; the six-step workflow below; the `gh` field list; the section floor; dark-first theming with a system font stack (no Google Fonts); `/tmp` for the temp file; slug `pr-board-<repo>` and title `<owner>/<repo> PR board`; the footer copy (provenance + "does not update itself" + the ~5-minute cache-lag note — Review Focus 5); and the report order (render link first, Gist link alongside, created/adopted/updated).

- [ ] **Step 1: Write `skills/pr-board/SKILL.md`**

Frontmatter per above, then the workflow:

1. **Identify the repo** from the session's location (git remote / `gh repo view --json nameWithOwner`).
2. **Pull live state**: `gh pr list --state open --json number,title,isDraft,headRefName,baseRefName,reviewDecision,reviewers,statusCheckRollup,author,updatedAt`, plus per-PR detail where curation needs it (conflict state, review comments).
3. **Curate with carry-over**: if a previous snapshot exists (fetch it via the stable raw URL — no auth needed), keep callouts still true against the live data, prune stale ones (merged, closed, superseded), add new ones from live data and current-session knowledge; every kept callout is re-verified against the live data, never carried over blindly; a first run with no previous snapshot curates purely from session context. Curation rules name what earns a callout: conflicts, keep-one decisions, approved-but-still-draft, long waits, merge-order risks, human-only steps.
4. **Build the board**: self-contained HTML (inline CSS, no external JS, < 200 KB), dark theme by default with light via `prefers-color-scheme`, system font stack. Section floor: header (repo · snapshot timestamp with age at a glance · headline counts) → needs attention (a few narrative callouts) → merge order (lanes per workstream; chips with arrows; `or` / `then`) → all open PRs table (PR · what · position · state pill · reviewer · checks · waiting on) → outstanding inputs (two columns when distinct groups) → dated notes → footer (data provenance, "does not update itself", the cache-lag note). The floor is not a lock — hierarchy, typography, and indicators may be improved; a darker theme is a plus.
5. **Publish**: write the HTML to `/tmp/pr-board-<slug>.html`; call `publish_artifact` with `slug: pr-board-<repo>`, `title: <owner>/<repo> PR board` (stable across updates — it is the adopt-match key).
6. **Report**: render link first, Gist link alongside, whether this was a create, an adopt, or an update.

- [ ] **Step 2: Verify the skill is registered**

The `skills` config entry was merged in Task 2. Run: `opencode api get /api/skill`
Expected: the list includes `pr-board` with its description.

- [ ] **Step 3: Commit**

```bash
git add skills/pr-board/SKILL.md
git commit -m "feat: pr-board skill — curated shareable PR board"
```

---

### Task 5: README + final acceptance

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything from Tasks 1–4
- Produces: install/usage documentation; the user's first real board

- [ ] **Step 1: Write `README.md`**

Sections: **What it is** (general artifact publishing + the PR board; the Gist is the durable store; the link is stable across updates). **Install** (the exact `~/.config/opencode/opencode.json` merge: `plugins` entry + `skills` entry; `opencode service restart`; prerequisite `gh` installed and `gh auth login` with the `gist` scope — check with `gh auth status`). **Usage** (`update the board` or `/board` in any session; `publish_artifact` for any HTML; the footer link + toast). **Link semantics** (render link = htmlpreview over the stable raw URL; Gist link = source; secret = obscurity not access control; in-place updates keep the URL; viewers may see the previous snapshot up to ~5 minutes after an update; on a new machine or wiped data dir the board is adopted, not duplicated — a loud "created" means the pinned link changed). **Troubleshooting** (token remediation text; 422 = surface GitHub's message; htmlpreview down = raw link still works; multiple-match warning = review your gists). **Development** (`node --test`; `node test/live-publish.mjs` creates/updates/deletes a real throwaway gist; the self-test slug is `opencode-artifacts-selftest`).

- [ ] **Step 2: Verify the full install surface**

Run: `opencode plugin list && opencode api get /api/skill`
Expected: `opencode-artifacts` listed as a loaded plugin; `pr-board` listed as a skill.

- [ ] **Step 3: Final acceptance — the user's first real board (user-driven)**

Ask the user to run, in a session in their IaC repo: `update the board`.
Expected: the agent loads the `pr-board` skill, pulls live PR data, curates, publishes, and reports the render link; the TUI footer shows the link and toasts; the user opens the render link in a browser and confirms the board displays. If anything is off, fix forward in a new commit — the design doc and this plan stay as the record of intent.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: install, usage, link semantics, troubleshooting"
```

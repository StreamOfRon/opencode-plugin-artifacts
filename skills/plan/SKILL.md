---
name: Plan
description: Publish a plan or spec document for peer review — creates or updates a stable, in-place-updating secret Gist link that agents and reviewers can view and discuss.
---

# Plan

When the user asks to **publish** or **share** a plan or spec document for peer review, follow this workflow exactly.

## Workflow

### 1. Create the plan document

Write the plan/spec content to a temporary HTML file at `/tmp/plan-<slug>.html` where `<slug>` is a kebab-case identifier derived from the plan title (e.g., `plan-microservice-refactor`).

**The HTML must be self-contained and follow these rules:**

- **Inline CSS only** — no external JS, no build step
- **Dark theme by default** with light via `prefers-color-scheme`
- **System font stack** — no Google Fonts
- **Target < 200 KB** (hard limit 1 MB)

**If you need any external assets** (icons, fonts, charting libraries, etc.), **always use a CDN link from [cdnjs](https://cdnjs.com/) or [jsdelivr](https://www.jsdelivr.com/) — never inline the content.** This keeps the artifact small and fast-loading.

Examples:
- Chart.js: `<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>`
- Tailwind CSS (play CDN): `<script src="https://cdn.tailwindcss.com"></script>`
- Font Awesome icons: `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">`
- Google Fonts alternative (via cdnjs): `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css">`

**Why?** The GitHub Gist has a 1 MB hard limit per file. Keeping the artifact small ensures it loads quickly for reviewers and stays within Gist constraints. Always prefer CDN-hosted libraries over inlining their source.

**Section floor** (in order):
1. **Header** — plan title, timestamp, author
2. **Summary** — one-paragraph overview of the plan
3. **Goals / Non-goals** — what this covers and what it doesn't
4. **Approach** — step-by-step breakdown
5. **Timeline** — rough milestones or phases
6. **Risks / Trade-offs** — known risks and mitigations
7. **Appendix** — any supplementary details, diagrams (as inline SVG or base64), references

### 2. Publish the plan

1. Call the `publish_artifact` tool with:
   - `slug: plan-<slug>` (e.g., `plan-microservice-refactor`)
   - `file: /tmp/plan-<slug>.html`
   - `title: Plan: <plan-title>` (stable across updates — this is the adopt-match key)
   - `visibility: secret` (default, never public)

### 3. Report

Report in this order:
1. **Render link** first (the `htmlpreview.github.io` link)
2. **Gist link** alongside
3. Whether this was a **create**, **adopt**, or **update**

Include a brief note that this plan is published for peer review and link back to the render link.

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

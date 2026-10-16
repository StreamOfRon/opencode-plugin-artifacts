import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync, mkdirSync } from "node:fs";

// Helper to create the temp HTML file used by publishArtifact tests
const TEST_FILE = "/tmp/test.html";
const ensureTestFile = () => {
  mkdirSync("/tmp", { recursive: true });
  writeFileSync(TEST_FILE, "<html><body>test</body></html>");
};

import type { GistRef } from "../src/publish.ts";
import {
  PublishError,
  AuthError,
  GistDeletedError,
  resolveToken,
  stableRawURL,
  renderURL,
  gistURL,
  createGist,
  updateGist,
  listGists,
  publishArtifact,
} from "../src/publish.ts";

// ── stableRawURL ──────────────────────────────────────────────────────────────

test("stableRawURL returns the SHA-less form", () => {
  const url = stableRawURL("octo", "abc123");
  assert.equal(
    url,
    "https://gist.githubusercontent.com/octo/abc123/raw"
  );
  assert.ok(
    !/\/raw\/[0-9a-f]{40}$/.test(url),
    "must not be SHA-pinned"
  );
});

// ── renderURL ─────────────────────────────────────────────────────────────────

test("renderURL wraps the stable raw URL", () => {
  const raw =
    "https://gist.githubusercontent.com/octo/abc123/raw";
  assert.equal(
    renderURL(raw),
    "https://htmlpreview.github.io/?https://gist.githubusercontent.com/octo/abc123/raw"
  );
});

// ── gistURL ───────────────────────────────────────────────────────────────────

test("gistURL returns the gist page URL", () => {
  assert.equal(
    gistURL("octo", "abc123"),
    "https://gist.github.com/octo/abc123"
  );
});

// ── resolveToken ──────────────────────────────────────────────────────────────

test("resolveToken reads gh auth token output", async () => {
  const exec = (cmd: string[]) => {
    if (
      cmd[0] === "gh" &&
      cmd[1] === "auth" &&
      cmd[2] === "token"
    )
      return Promise.resolve({ ok: true, stdout: "gho_tok\n" });
    return Promise.resolve({ ok: false, stdout: "" });
  };
  assert.equal(await resolveToken({}, exec), "gho_tok");
});

test("resolveToken falls back to GH_TOKEN when gh missing", async () => {
  const exec = () => Promise.resolve({ ok: false, stdout: "" });
  assert.equal(
    await resolveToken({ GH_TOKEN: "env_tok" }, exec),
    "env_tok"
  );
});

test("resolveToken falls back to GITHUB_TOKEN when gh missing", async () => {
  const exec = () => Promise.resolve({ ok: false, stdout: "" });
  assert.equal(
    await resolveToken({ GITHUB_TOKEN: "ghithub_tok" }, exec),
    "ghithub_tok"
  );
});

test("resolveToken rejects with remediation when no token available", async () => {
  const exec = () => Promise.resolve({ ok: false, stdout: "" });
  try {
    await resolveToken({}, exec);
    assert.fail("should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof PublishError);
    assert.ok(err.message.includes("brew install gh"));
    assert.ok(err.message.includes("gist scope"));
  }
});

// ── createGist ────────────────────────────────────────────────────────────────

test("createGist sends correct request and returns GistRef", async () => {
  let captured: any = null;
  const fakeFetch = async (url: any, options: any) => {
    captured = { url: String(url), ...options };
    return {
      ok: true,
      status: 201,
      json: async () => ({
        id: "g1",
        owner: { login: "octo" },
        html_url: "https://gist.github.com/octo/g1",
      }),
    };
  };

  const ref = await createGist(
    "tok",
    { title: "Test Board", content: "body", visibility: "secret" },
    fakeFetch
  );

  assert.equal(ref.gistID, "g1");
  assert.equal(ref.owner, "octo");
  assert.equal(ref.url, "https://gist.github.com/octo/g1");

  const body = JSON.parse(captured.body);
  assert.equal(body.description, "Test Board");
  assert.equal(body.files["index.html"].content, "body");
  assert.equal(body.public, false);
});

test("createGist with public visibility", async () => {
  let captured: any = null;
  const fakeFetch = async (url: any, options: any) => {
    captured = { url: String(url), ...options };
    return {
      ok: true,
      status: 201,
      json: async () => ({
        id: "g2",
        owner: { login: "octo" },
        html_url: "https://gist.github.com/octo/g2",
      }),
    };
  };

  await createGist(
    "tok",
    { title: "Pub Board", content: "body", visibility: "public" },
    fakeFetch
  );

  const body = JSON.parse(captured.body);
  assert.equal(body.public, true);
});

test("createGist on 401 rejects with AuthError", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 401,
    headers: new Map(),
  });

  try {
    await createGist(
      "bad",
      { title: "T", content: "C", visibility: "secret" },
      fakeFetch
    );
    assert.fail("should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof AuthError);
    assert.equal(err.code, "auth");
  }
});

// ── updateGist ────────────────────────────────────────────────────────────────

test("updateGist on 200 resolves", async () => {
  let captured: any = null;
  const fakeFetch = async (url: any, options: any) => {
    captured = { url: String(url), ...options };
    return { ok: true, status: 200, json: async () => ({}) };
  };

  await updateGist("tok", "g1", "new content", fakeFetch);

  const body = JSON.parse(captured.body);
  assert.deepEqual(body.files, {
    "index.html": { content: "new content" },
  });
});

test("updateGist on 404 rejects with GistDeletedError", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 404,
    headers: new Map(),
  });

  try {
    await updateGist("tok", "g1", "C", fakeFetch);
    assert.fail("should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof GistDeletedError);
    assert.equal(err.code, "deleted");
  }
});

test("updateGist on 401 rejects with AuthError", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 401,
    headers: new Map(),
  });

  try {
    await updateGist("tok", "g1", "C", fakeFetch);
    assert.fail("should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof AuthError);
    assert.equal(err.code, "auth");
  }
});

test("updateGist on 403 rejects with AuthError", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 403,
    headers: new Map(),
  });

  try {
    await updateGist("tok", "g1", "C", fakeFetch);
    assert.fail("should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof AuthError);
    assert.equal(err.code, "auth");
  }
});

// ── listGists ─────────────────────────────────────────────────────────────────

test("listGists returns gist summaries", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => [
      {
        id: "g1",
        owner: { login: "octo" },
        description: "Test Board",
      },
    ],
  });

  const gists = await listGists("tok", fakeFetch);
  assert.equal(gists.length, 1);
  assert.equal(gists[0].id, "g1");
  assert.equal(gists[0].owner, "octo");
  assert.equal(gists[0].description, "Test Board");
});

// ── publishArtifact — existing gist (update) ──────────────────────────────────

test("publishArtifact happy path with existing gist", async () => {
  ensureTestFile();
  let requestCount = 0;
  const fakeFetch = async (url: any, options: any) => {
    requestCount++;
    if (String(url).includes("/gists/g-existing")) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    assert.fail("should not list gists when existing is set");
  };

  const existing: GistRef = {
    gistID: "g-existing",
    owner: "octo",
    url: "https://gist.github.com/octo/g-existing",
  };

  const result = await publishArtifact(
    {
      token: "tok",
      slug: "test-slug",
      file: "/tmp/test.html",
      title: "Test Board",
      visibility: "secret",
      existing,
    },
    fakeFetch
  );

  assert.equal(result.created, false);
  assert.equal(result.adopted, false);
  assert.equal(result.ref.gistID, "g-existing");
  assert.equal(result.ref.owner, "octo");
  assert.equal(
    result.rawURL,
    "https://gist.githubusercontent.com/octo/g-existing/raw"
  );
  assert.equal(
    result.renderURL,
    "https://htmlpreview.github.io/?https://gist.githubusercontent.com/octo/g-existing/raw"
  );
});

// ── publishArtifact — existing-but-deleted (recreate) ─────────────────────────

test("publishArtifact existing-but-deleted → recreate", async () => {
  ensureTestFile();
  let requestCount = 0;
  const fakeFetch = async (url: any, options: any) => {
    requestCount++;
    if (String(url).includes("/gists/g-deleted")) {
      return { ok: false, status: 404, headers: new Map() };
    }
    // POST → 201
    return {
      ok: true,
      status: 201,
      json: async () => ({
        id: "g-new",
        owner: { login: "octo" },
        html_url: "https://gist.github.com/octo/g-new",
      }),
    };
  };

  const existing: GistRef = {
    gistID: "g-deleted",
    owner: "oldowner",
    url: "https://gist.github.com/oldowner/g-deleted",
  };

  const result = await publishArtifact(
    {
      token: "tok",
      slug: "test-slug",
      file: "/tmp/test.html",
      title: "Test Board",
      visibility: "secret",
      existing,
    },
    fakeFetch
  );

  assert.equal(result.created, true);
  assert.equal(result.adopted, false);
  assert.equal(result.ref.gistID, "g-new");
});

// ── publishArtifact — adopt (one match) ───────────────────────────────────────

test("publishArtifact no existing, one match → adopt", async () => {
  ensureTestFile();
  let requestCount = 0;
  const fakeFetch = async (url: any, options: any) => {
    requestCount++;
    if (String(url) === "https://api.github.com/gists") {
      if (options.method === "POST") {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "g-adopt",
            owner: { login: "octo" },
            description: "Test Board",
          },
        ],
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const result = await publishArtifact(
    {
      token: "tok",
      slug: "test-slug",
      file: "/tmp/test.html",
      title: "Test Board",
      visibility: "secret",
    },
    fakeFetch
  );

  assert.equal(result.created, false);
  assert.equal(result.adopted, true);
  assert.equal(result.ref.gistID, "g-adopt");
});

// ── publishArtifact — create (zero matches) ───────────────────────────────────

test("publishArtifact no existing, zero matches → create", async () => {
  ensureTestFile();
  let requestCount = 0;
  const fakeFetch = async (url: any, options: any) => {
    requestCount++;
    if (String(url) === "https://api.github.com/gists") {
      if (options.method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "g-new",
            owner: { login: "octo" },
            html_url: "https://gist.github.com/octo/g-new",
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const result = await publishArtifact(
    {
      token: "tok",
      slug: "test-slug",
      file: "/tmp/test.html",
      title: "Test Board",
      visibility: "secret",
    },
    fakeFetch
  );

  assert.equal(result.created, true);
  assert.equal(result.adopted, false);
  assert.equal(result.warning, undefined);
});

// ── publishArtifact — create with warning (multiple matches) ──────────────────

test("publishArtifact no existing, two matches → create with warning", async () => {
  ensureTestFile();
  let requestCount = 0;
  const fakeFetch = async (url: any, options: any) => {
    requestCount++;
    if (String(url) === "https://api.github.com/gists") {
      if (options.method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "g-new",
            owner: { login: "octo" },
            html_url: "https://gist.github.com/octo/g-new",
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            id: "g-old1",
            owner: { login: "octo" },
            description: "Test Board",
          },
          {
            id: "g-old2",
            owner: { login: "octo" },
            description: "Test Board",
          },
        ],
      };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const result = await publishArtifact(
    {
      token: "tok",
      slug: "test-slug",
      file: "/tmp/test.html",
      title: "Test Board",
      visibility: "secret",
    },
    fakeFetch
  );

  assert.equal(result.created, true);
  assert.equal(result.adopted, false);
  assert.ok(result.warning);
  assert.ok(result.warning!.includes("Test Board"));
});

// ── publishArtifact — missing file ────────────────────────────────────────────

test("publishArtifact with missing file rejects", async () => {
  try {
    await publishArtifact(
      {
        token: "tok",
        slug: "test-slug",
        file: "/nonexistent/path/to/file.html",
        title: "Test Board",
        visibility: "secret",
      },
      async () => {
        throw new Error("should not reach API");
      }
    );
    assert.fail("should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof PublishError);
    assert.ok(
      err.message.includes("nonexistent/path/to/file.html") ||
        err.message.includes("file") ||
        err.message.includes("Not found")
    );
  }
});

// ── 422 / 500 surface GitHub error ────────────────────────────────────────────

test("createGist on 422 surfaces GitHub error message", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 422,
    headers: new Map(),
    json: async () => ({
      message: "Validation Failed: resource already exists",
    }),
  });

  try {
    await createGist(
      "tok",
      { title: "T", content: "C", visibility: "secret" },
      fakeFetch
    );
    assert.fail("should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof PublishError);
    assert.ok(err.message.includes("Validation Failed"));
  }
});

test("updateGist on 500 surfaces GitHub error message", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 500,
    headers: new Map(),
    json: async () => ({ message: "Service Unavailable" }),
  });

  try {
    await updateGist("tok", "g1", "C", fakeFetch);
    assert.fail("should have thrown");
  } catch (err: any) {
    assert.ok(err instanceof PublishError);
    assert.ok(err.message.includes("Service Unavailable"));
  }
});

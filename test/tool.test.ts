import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFileSync, mkdirSync } from "node:fs";

import type { GistRef, PublishResult } from "../src/publish.ts";
import { publishArtifact } from "../src/publish.ts";
import {
  createPublishArtifactTool,
  type ArtifactStorage,
} from "../src/tool.ts";

const TEST_FILE = "/tmp/tool-test.html";
const ensureTestFile = () => {
  mkdirSync("/tmp", { recursive: true });
  writeFileSync(TEST_FILE, "<html><body>test</body></html>");
};

const REF: GistRef = {
  gistID: "g1",
  owner: "octo",
  url: "https://gist.github.com/octo/g1",
};

function fakeResult(
  overrides: Partial<PublishResult> = {}
): PublishResult {
  return {
    created: false,
    adopted: false,
    ref: REF,
    gistURL: REF.url,
    rawURL: "https://gist.githubusercontent.com/octo/g1/raw",
    renderURL:
      "https://htmlpreview.github.io/?https://gist.githubusercontent.com/octo/g1/raw",
    ...overrides,
  };
}

// Regression: Tool.Context has no `storage`. Invoking the tool through Code
// Mode used to crash on `ctx.storage.get` before publishing anything.
test("publish_artifact executes when storage is missing", async () => {
  ensureTestFile();
  let received: any;
  const tool = createPublishArtifactTool(undefined, {
    resolveToken: async () => "tok",
    publishArtifact: async (input) => {
      received = input;
      return fakeResult();
    },
  });

  const result = await tool.execute(
    { slug: "setup-config", file: TEST_FILE },
    {}
  );

  assert.equal(received.existing, undefined);
  assert.equal(received.title, "setup-config");
  assert.equal(received.visibility, "secret");
  assert.equal(received.file, TEST_FILE);
  assert.match(result.content, /Published setup-config \(updated\)/);
  assert.ok(result.content.includes(REF.url));
});

test("publish_artifact uses setup storage when invocation context lacks it", async () => {
  ensureTestFile();
  const existing: GistRef = {
    gistID: "g-existing",
    owner: "octo",
    url: "https://gist.github.com/octo/g-existing",
  };
  const gets: string[] = [];
  const sets: Array<[string, any]> = [];
  const storage: ArtifactStorage = {
    get: async (key) => {
      gets.push(key);
      return existing;
    },
    set: async (key, value) => {
      sets.push([key, value]);
    },
  };
  let received: any;
  const tool = createPublishArtifactTool(storage, {
    resolveToken: async () => "tok",
    publishArtifact: async (input) => {
      received = input;
      return fakeResult();
    },
  });

  await tool.execute(
    { slug: "setup-config", file: TEST_FILE, title: "Setup Config" },
    {}
  );

  assert.deepEqual(received.existing, existing);
  assert.deepEqual(gets, ["artifact:setup-config"]);
  assert.deepEqual(sets[0], ["artifact:setup-config", REF]);
  assert.equal(sets[1][0], "lastPublished");
  assert.equal(sets[1][1].slug, "setup-config");
  assert.equal(sets[1][1].url, fakeResult().rawURL);
  assert.equal(sets[1][1].renderURL, fakeResult().renderURL);
  assert.ok(sets[1][1].at);
});

test("publish_artifact still publishes when storage throws", async () => {
  ensureTestFile();
  const storage: ArtifactStorage = {
    get: async () => {
      throw new Error("storage unavailable");
    },
    set: async () => {
      throw new Error("storage unavailable");
    },
  };

  const tool = createPublishArtifactTool(storage, {
    resolveToken: async () => "tok",
    publishArtifact: async () => fakeResult(),
  });

  const result = await tool.execute(
    { slug: "setup-config", file: TEST_FILE },
    {}
  );

  assert.match(result.content, /Published setup-config/);
});

test("publish_artifact adopts a unique gist when storage is missing", async () => {
  ensureTestFile();
  let patched = false;
  let created = false;
  const fakeFetch = async (url: any, options: any) => {
    if (String(url) === "https://api.github.com/gists") {
      if (options.method === "POST") {
        created = true;
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
            id: "g-adopt",
            owner: { login: "octo" },
            description: "Setup Config",
          },
        ],
      };
    }
    if (String(url).endsWith("/gists/g-adopt")) {
      patched = true;
      return { ok: true, status: 200, json: async () => ({}) };
    }
    assert.fail(`unexpected request: ${url}`);
  };

  const tool = createPublishArtifactTool(undefined, {
    resolveToken: async () => "tok",
    publishArtifact: (input) =>
      publishArtifact(input, fakeFetch as typeof fetch),
  });

  const result = await tool.execute(
    { slug: "setup-config", file: TEST_FILE, title: "Setup Config" },
    {}
  );

  assert.equal(patched, true);
  assert.equal(created, false);
  assert.match(result.content, /\(adopted\)/);
  assert.ok(result.content.includes("g-adopt"));
});

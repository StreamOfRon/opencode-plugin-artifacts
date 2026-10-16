import { resolveToken, publishArtifact } from "../src/publish.js";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { strict as assert } from "node:assert";

const SLUG = "opencode-artifacts-selftest";
const FILE = "/tmp/opencode-artifacts-selftest.html";
const TITLE = "opencode-artifacts self-test (delete me)";

let gistID = null;

try {
  // Step 1: resolve token
  const token = await resolveToken();
  console.log("✓ Token resolved");

  // Step 2: write temp file with v1 marker
  const v1Content = `<html><body><h1>v1-${Date.now()}</h1></body></html>`;
  await writeFile(FILE, v1Content);
  console.log("✓ Wrote v1 to", FILE);

  // Publish — should create a new gist
  const result = await publishArtifact({
    token,
    slug: SLUG,
    file: FILE,
    title: TITLE,
    visibility: "secret",
  });

  assert.equal(result.created, true, "should be created (first publish)");
  assert.equal(
    result.rawURL,
    `https://gist.githubusercontent.com/${result.ref.owner}/${result.ref.gistID}/raw`,
    "rawURL should be the stable form"
  );
  gistID = result.ref.gistID;
  console.log(`✓ Created gist ${gistID}`);
  console.log(`  raw:  ${result.rawURL}`);
  console.log(`  render: ${result.renderURL}`);

  // Step 3: fetch the raw URL — should be 200
  const rawRes = await fetch(result.rawURL);
  assert.equal(rawRes.status, 200, "raw URL should return 200");
  console.log("✓ Raw URL returns 200");

  // Also verify via API that content is present
  const apiRes = await fetch(
    `https://api.github.com/gists/${gistID}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );
  const apiData = await apiRes.json();
  const apiContent = apiData.files["index.html"].content;
  assert.ok(
    apiContent.includes("v1-"),
    "API should show v1 content"
  );
  console.log("✓ API confirms v1 content in gist");

  // Step 4: rewrite with v2 and publish again (update)
  const v2Content = `<html><body><h1>v2-${Date.now()}</h1></body></html>`;
  await writeFile(FILE, v2Content);

  const updateResult = await publishArtifact({
    token,
    slug: SLUG,
    file: FILE,
    title: TITLE,
    visibility: "secret",
    existing: result.ref,
  });

  assert.equal(updateResult.created, false, "should be updated, not created");
  assert.equal(updateResult.adopted, false, "should not be adopted");
  console.log("✓ Updated gist (created=false, adopted=false)");

  // Check API shows v2 (API reads are fresh)
  const apiRes2 = await fetch(
    `https://api.github.com/gists/${gistID}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );
  const apiData2 = await apiRes2.json();
  const apiContent2 = apiData2.files["index.html"].content;
  assert.ok(
    apiContent2.includes("v2-"),
    "API should show v2 content after update"
  );
  console.log("✓ API confirms v2 content after update");

  // Step 5: fetch raw URL — may still be v1 within cache window; assert status only
  const rawRes2 = await fetch(result.rawURL);
  assert.equal(rawRes2.status, 200, "raw URL should return 200 after update");
  console.log("✓ Raw URL returns 200 after update (may show v1 within cache window)");

  // If LIVE_WAIT_CONVERGE=1, poll up to 320s for v2 convergence
  if (process.env.LIVE_WAIT_CONVERGE === "1") {
    console.log("  [LIVE_WAIT_CONVERGE=1] Polling for v2 convergence...");
    for (let i = 0; i < 64; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const body = await fetch(result.rawURL).then((r) => r.text());
      if (body.includes("v2-")) {
        console.log(`  ✓ Converged on v2 after ${(i + 1) * 5}s`);
        break;
      }
      if (i === 63) {
        console.log("  ⚠ Did not converge on v2 within 320s (expected within ~5min cache)");
      }
    }
  }

  // Step 6: fetch render URL — should be 200
  const renderRes = await fetch(result.renderURL);
  assert.equal(renderRes.status, 200, "render URL should return 200");
  console.log("✓ Render URL returns 200");

  // Step 7: cleanup — delete the gist
  console.log(`\nDeleting gist ${gistID}...`);
  const { spawn } = await import("node:child_process");
  const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
    const proc = spawn("gh", ["gist", "delete", gistID, "--yes"], {
      env: { ...process.env },
    });
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout });
      else reject(new Error(`gh exit code ${code}: ${stdout.trim()}`));
    });
  });
  console.log("✓ Gist deleted");

  // Remove temp file
  await unlink(FILE);
  console.log("✓ Cleaned up temp file");

  console.log("\n✅ All assertions passed — live integration test complete");
  process.exit(0);
} catch (err) {
  console.error(`\n❌ Step ${gistID ? "cleanup" : "test"} failed:`, err.message);
  // Attempt cleanup of any created gist
  if (gistID) {
    try {
      const { spawn } = await import("node:child_process");
      await new Promise((resolve, reject) => {
        const proc = spawn("gh", ["gist", "delete", gistID, "--yes"], {
          env: { ...process.env },
        });
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`cleanup failed: ${code}`));
        });
      });
      console.log("✓ Cleaned up gist", gistID);
    } catch (cleanupErr) {
      console.error("  Cleanup also failed:", cleanupErr.message);
    }
  }
  // Clean up temp file
  try {
    await unlink(FILE);
  } catch {
    // ignore
  }
  process.exit(1);
}

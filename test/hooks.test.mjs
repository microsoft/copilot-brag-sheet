/**
 * Tests for hooks/post-tool-use.mjs — Agency PostToolUse hook script.
 *
 * Runs the hook as a subprocess with synthetic JSON on stdin, verifying
 * that stdout is exactly one valid JSON object (no console.log pollution)
 * and that the classification is correct.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const hookPath = join(__dirname, "..", "hooks", "post-tool-use.mjs");

function runHook(payload) {
  return new Promise((resolve, reject) => {
    const child = execFile("node", [hookPath], {
      timeout: 10000,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve({ stdout, stderr });
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

describe("hooks post-tool-use", () => {
  it("returns valid JSON with continue:true for a file edit", async () => {
    const { stdout } = await runHook({
      tool_name: "edit",
      tool_input: { path: "/repo/src/main.ts" },
      tool_result: {},
    });

    const result = JSON.parse(stdout);
    assert.equal(result.continue, true);
    assert.ok(result.classification);
    assert.deepEqual(result.classification.filesEdited, ["/repo/src/main.ts"]);
  });

  it("returns valid JSON with continue:true for an unrecognized tool", async () => {
    const { stdout } = await runHook({
      tool_name: "grep",
      tool_input: { pattern: "foo" },
      tool_result: {},
    });

    const result = JSON.parse(stdout);
    assert.equal(result.continue, true);
    assert.equal(result.classification, undefined);
  });

  it("returns valid JSON for PR creation", async () => {
    const { stdout } = await runHook({
      tool_name: "github-create_pull_request",
      tool_input: { title: "fix: auth", owner: "org", repo: "api" },
      tool_result: { resultType: "success", textResultForLlm: '{"number": 42}' },
    });

    const result = JSON.parse(stdout);
    assert.equal(result.continue, true);
    assert.equal(result.classification.prsCreated.length, 1);
    assert.equal(result.classification.prsCreated[0].id, 42);
    assert.ok(result.classification.significantActions.includes("pr created"));
  });

  it("returns valid JSON even on malformed input", async () => {
    const { stdout } = await runHook("not json at all");

    // Should not throw — graceful fallback
    const result = JSON.parse(stdout);
    assert.equal(result.continue, true);
  });

  it("stdout contains exactly one JSON object (no console.log pollution)", async () => {
    const { stdout } = await runHook({
      tool_name: "create",
      tool_input: { path: "/repo/new.ts" },
      tool_result: {},
    });

    // Stdout must be parseable as a single JSON object
    const trimmed = stdout.trim();
    assert.ok(trimmed.startsWith("{"), "stdout must start with {");
    assert.ok(trimmed.endsWith("}"), "stdout must end with }");
    JSON.parse(trimmed); // must not throw
  });

  it("handles camelCase payload fields (Copilot adapter format)", async () => {
    const { stdout } = await runHook({
      toolName: "bash",
      toolArgs: { command: "git push origin main" },
      toolResult: {},
    });

    const result = JSON.parse(stdout);
    assert.equal(result.continue, true);
    assert.ok(result.classification.significantActions.includes("git push"));
  });
});

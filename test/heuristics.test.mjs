/**
 * Tests for lib/heuristics.mjs — tool classification and event detection.
 *
 * Migrated from inline re-implementations in test/extension.test.mjs to
 * real imports. These define the contract for the heuristics module.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FILE_CREATE_TOOLS,
  FILE_EDIT_TOOLS,
  PR_TOOLS,
  SHELL_TOOLS,
  extractFilePath,
  extractPrInfo,
  detectShellGitAction,
  isBragRequest,
  classifyToolUse,
} from "../lib/heuristics.mjs";

// ── Tool classification sets ────────────────────────────────────────────────

describe("heuristics tool classification sets", () => {
  it("FILE_CREATE_TOOLS contains expected tools", () => {
    assert.ok(FILE_CREATE_TOOLS.has("create"));
    assert.ok(FILE_CREATE_TOOLS.has("create_file"));
    assert.ok(!FILE_CREATE_TOOLS.has("edit"));
  });

  it("FILE_EDIT_TOOLS contains expected tools", () => {
    assert.ok(FILE_EDIT_TOOLS.has("edit"));
    assert.ok(FILE_EDIT_TOOLS.has("edit_file"));
    assert.ok(FILE_EDIT_TOOLS.has("str_replace_editor"));
    assert.ok(!FILE_EDIT_TOOLS.has("create"));
  });

  it("PR_TOOLS contains expected tools", () => {
    assert.ok(PR_TOOLS.has("github-create_pull_request"));
    assert.ok(PR_TOOLS.has("github-create_pull_request_with_copilot"));
    assert.ok(PR_TOOLS.has("ado-corp-repo_create_pull_request"));
    assert.ok(!PR_TOOLS.has("github-list_pull_requests"));
  });

  it("SHELL_TOOLS contains expected tools", () => {
    assert.ok(SHELL_TOOLS.has("powershell"));
    assert.ok(SHELL_TOOLS.has("bash"));
    assert.ok(!SHELL_TOOLS.has("node"));
  });
});

// ── extractFilePath ─────────────────────────────────────────────────────────

describe("heuristics extractFilePath", () => {
  it("extracts path from tool args", () => {
    assert.equal(extractFilePath({ path: "/repo/src/main.ts" }), "/repo/src/main.ts");
  });

  it("returns null when no path property", () => {
    assert.equal(extractFilePath({ file: "test.js" }), null);
    assert.equal(extractFilePath({}), null);
  });

  it("returns null for null/undefined args", () => {
    assert.equal(extractFilePath(null), null);
    assert.equal(extractFilePath(undefined), null);
  });
});

// ── extractPrInfo ───────────────────────────────────────────────────────────

describe("heuristics extractPrInfo", () => {
  it("extracts PR info from tool args and result", () => {
    const args = { title: "fix: auth bug", owner: "org", repo: "api" };
    const result = { resultType: "success", textResultForLlm: '{"number": 42}' };

    const info = extractPrInfo("github-create_pull_request", args, result);
    assert.equal(info.title, "fix: auth bug");
    assert.equal(info.repo, "org/api");
    assert.equal(info.id, 42);
  });

  it("returns null on failure result", () => {
    const args = { title: "fix" };
    const result = { resultType: "failure", textResultForLlm: "Error" };
    assert.equal(extractPrInfo("github-create_pull_request", args, result), null);
  });

  it("extracts PR number from pullRequestId pattern", () => {
    const args = { title: "feat", owner: "ms", repo: "proj" };
    const result = { resultType: "success", textResultForLlm: 'pullRequestId: 99' };

    const info = extractPrInfo("ado-corp-repo_create_pull_request", args, result);
    assert.equal(info.id, 99);
  });

  it("returns info with title even without PR number", () => {
    const args = { title: "my pr", owner: "me", repo: "stuff" };
    const result = { resultType: "success", textResultForLlm: "created" };

    const info = extractPrInfo("github-create_pull_request", args, result);
    assert.equal(info.title, "my pr");
    assert.equal(info.id, null);
  });

  it("builds repo as owner/repo when both present", () => {
    const args = { title: "x", owner: "org", repo: "r" };
    const result = { resultType: "success", textResultForLlm: "" };

    const info = extractPrInfo("github-create_pull_request", args, result);
    assert.equal(info.repo, "org/r");
  });

  it("uses repo alone when owner is absent", () => {
    const args = { title: "x", repo: "solo" };
    const result = { resultType: "success", textResultForLlm: "" };

    const info = extractPrInfo("github-create_pull_request", args, result);
    assert.equal(info.repo, "solo");
  });

  it("returns null when no title and no PR number", () => {
    const args = {};
    const result = { resultType: "success", textResultForLlm: "done" };
    assert.equal(extractPrInfo("github-create_pull_request", args, result), null);
  });
});

// ── detectShellGitAction ────────────────────────────────────────────────────

describe("heuristics detectShellGitAction", () => {
  it("detects git commit", () => {
    assert.equal(detectShellGitAction('git commit -m "fix"'), "git commit");
  });

  it("detects git push", () => {
    assert.equal(detectShellGitAction("git push origin main"), "git push");
  });

  it("returns null for non-git commands", () => {
    assert.equal(detectShellGitAction("npm test"), null);
    assert.equal(detectShellGitAction("ls -la"), null);
  });

  it("returns null for empty/null commands", () => {
    assert.equal(detectShellGitAction(null), null);
    assert.equal(detectShellGitAction(""), null);
    assert.equal(detectShellGitAction(undefined), null);
  });

  it("only detects commit and push (not merge/rebase/tag)", () => {
    assert.equal(detectShellGitAction("git merge main"), null);
    assert.equal(detectShellGitAction("git rebase -i HEAD~3"), null);
    assert.equal(detectShellGitAction("git tag v1.0"), null);
  });
});

// ── isBragRequest ───────────────────────────────────────────────────────────

describe("heuristics isBragRequest", () => {
  it("detects 'brag' as standalone word", () => {
    assert.ok(isBragRequest("Save this to my brag sheet"));
    assert.ok(isBragRequest("brag"));
    assert.ok(isBragRequest("BRAG about this"));
  });

  it("excludes bragging and braggart", () => {
    assert.ok(!isBragRequest("stop bragging"));
    assert.ok(!isBragRequest("don't be a braggart"));
  });

  it("detects brag even when bragging also appears in prompt", () => {
    assert.ok(isBragRequest("bragging rights aside, brag about this fix"));
    assert.ok(isBragRequest("don't be a braggart — brag about this"));
  });

  it("does not trigger on unrelated text", () => {
    assert.ok(!isBragRequest("fix the login bug"));
    assert.ok(!isBragRequest("review my code"));
  });

  it("returns false for null/undefined/empty", () => {
    assert.ok(!isBragRequest(null));
    assert.ok(!isBragRequest(undefined));
    assert.ok(!isBragRequest(""));
  });
});

// ── classifyToolUse ─────────────────────────────────────────────────────────

describe("heuristics classifyToolUse", () => {
  it("classifies file create tool", () => {
    const result = classifyToolUse({
      toolName: "create",
      toolArgs: { path: "/repo/src/new.ts" },
      toolResult: {},
    });
    assert.deepEqual(result.filesCreated, ["/repo/src/new.ts"]);
    assert.deepEqual(result.filesEdited, []);
    assert.deepEqual(result.prsCreated, []);
    assert.deepEqual(result.significantActions, []);
  });

  it("classifies file edit tool", () => {
    const result = classifyToolUse({
      toolName: "edit",
      toolArgs: { path: "/repo/src/main.ts" },
      toolResult: {},
    });
    assert.deepEqual(result.filesEdited, ["/repo/src/main.ts"]);
    assert.deepEqual(result.filesCreated, []);
  });

  it("classifies PR creation", () => {
    const result = classifyToolUse({
      toolName: "github-create_pull_request",
      toolArgs: { title: "fix: bug", owner: "org", repo: "api" },
      toolResult: { resultType: "success", textResultForLlm: '{"number": 7}' },
    });
    assert.equal(result.prsCreated.length, 1);
    assert.equal(result.prsCreated[0].id, 7);
    assert.equal(result.prsCreated[0].title, "fix: bug");
    assert.ok(result.significantActions.includes("pr created"));
  });

  it("classifies github-push_files as git push action", () => {
    const result = classifyToolUse({
      toolName: "github-push_files",
      toolArgs: {},
      toolResult: {},
    });
    assert.ok(result.significantActions.includes("git push"));
  });

  it("classifies shell git commit", () => {
    const result = classifyToolUse({
      toolName: "powershell",
      toolArgs: { command: 'git commit -m "fix"' },
      toolResult: {},
    });
    assert.ok(result.significantActions.includes("git commit"));
  });

  it("classifies shell git push", () => {
    const result = classifyToolUse({
      toolName: "bash",
      toolArgs: { command: "git push origin main" },
      toolResult: {},
    });
    assert.ok(result.significantActions.includes("git push"));
  });

  it("returns empty classification for unrecognized tool", () => {
    const result = classifyToolUse({
      toolName: "grep",
      toolArgs: { pattern: "foo" },
      toolResult: {},
    });
    assert.deepEqual(result.filesCreated, []);
    assert.deepEqual(result.filesEdited, []);
    assert.deepEqual(result.prsCreated, []);
    assert.deepEqual(result.significantActions, []);
  });

  it("returns empty classification for shell tool with non-git command", () => {
    const result = classifyToolUse({
      toolName: "bash",
      toolArgs: { command: "npm test" },
      toolResult: {},
    });
    assert.deepEqual(result.significantActions, []);
  });

  it("handles missing toolArgs gracefully", () => {
    const result = classifyToolUse({
      toolName: "create",
      toolArgs: null,
      toolResult: {},
    });
    assert.deepEqual(result.filesCreated, []);
  });

  it("skips failed PR results", () => {
    const result = classifyToolUse({
      toolName: "github-create_pull_request",
      toolArgs: { title: "fix" },
      toolResult: { resultType: "failure" },
    });
    assert.deepEqual(result.prsCreated, []);
    assert.deepEqual(result.significantActions, []);
  });
});

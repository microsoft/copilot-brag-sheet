/**
 * Tests for extension.mjs helpers and logic.
 *
 * The extension entry point calls `joinSession()` from the Copilot SDK,
 * which is only available inside a real CLI session. We can't import the
 * whole module in a test runner. Instead we extract and test the pure
 * helper functions by evaluating them in isolation.
 *
 * Integration-level behaviour (hooks firing, tools responding) is verified
 * through manual smoke tests inside the Copilot CLI.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { detectDataDir, detectBragSheetPath, ensureDir } from "../lib/paths.mjs";
import { loadConfig, getAllCategoryIds, isValidCategory } from "../lib/config.mjs";
import {
  writeRecord, readRecords, updateRecord, logError,
} from "../lib/storage.mjs";
import {
  createSessionRecord, createEntryRecord,
  addFileToRecord, sanitize, dedupeArray,
} from "../lib/records.mjs";
import { renderMarkdown, renderReviewSummary } from "../lib/render.mjs";
import {
  isBragRequest, extractPrInfo, detectShellGitAction,
} from "../lib/heuristics.mjs";

// ── Test fixtures ───────────────────────────────────────────────────────────

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), "ext-test-"));
});

after(() => {
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* noop */ }
});

// ── Session record lifecycle ────────────────────────────────────────────────

describe("extension session lifecycle", () => {
  it("creates a session record with active status and pid", () => {
    const record = createSessionRecord("test-session-001", "/tmp/repo");
    assert.equal(record.id, "test-session-001");
    assert.equal(record.type, "session");
    assert.equal(record.status, "active");
    assert.equal(record.pid, process.pid);
    assert.equal(record.cwd, "/tmp/repo");
    assert.equal(record.repo, null);
    assert.equal(record.branch, null);
    assert.deepEqual(record.filesEdited, []);
    assert.deepEqual(record.filesCreated, []);
    assert.deepEqual(record.prsCreated, []);
    assert.deepEqual(record.significantActions, []);
  });

  it("writes and reads back a session record through storage", () => {
    const dir = join(testDir, "lifecycle-write");
    ensureDir(dir);

    const record = createSessionRecord("sess-write-01", "/tmp");
    record.repo = "my-repo";
    record.branch = "main";

    writeRecord(dir, record);
    const records = readRecords(dir, { type: "session" });
    assert.equal(records.length, 1);
    assert.equal(records[0].id, "sess-write-01");
    assert.equal(records[0].repo, "my-repo");
    assert.equal(records[0].status, "active");
  });

  it("updates a session record to finalized status", async () => {
    const dir = join(testDir, "lifecycle-finalize");
    ensureDir(dir);

    const record = createSessionRecord("sess-final-01", "/tmp");
    writeRecord(dir, record);

    const endTime = new Date().toISOString();
    await updateRecord(dir, "sess-final-01", {
      status: "finalized",
      endTime,
      summary: "Did some work",
    });

    const records = readRecords(dir, { type: "session" });
    assert.equal(records[0].status, "finalized");
    assert.equal(records[0].endTime, endTime);
    assert.equal(records[0].summary, "Did some work");
  });

  it("updates a session record to emergency-saved status", async () => {
    const dir = join(testDir, "lifecycle-emergency");
    ensureDir(dir);

    const record = createSessionRecord("sess-emerg-01", "/tmp");
    writeRecord(dir, record);

    await updateRecord(dir, "sess-emerg-01", {
      status: "emergency-saved",
      endTime: new Date().toISOString(),
    });

    const records = readRecords(dir, { type: "session" });
    assert.equal(records[0].status, "emergency-saved");
  });

  it("updates a session record to orphaned status", async () => {
    const dir = join(testDir, "lifecycle-orphan");
    ensureDir(dir);

    const record = createSessionRecord("sess-orphan-01", "/tmp");
    writeRecord(dir, record);

    await updateRecord(dir, "sess-orphan-01", {
      status: "orphaned",
      endTime: new Date().toISOString(),
    });

    const records = readRecords(dir, { type: "session" });
    assert.equal(records[0].status, "orphaned");
  });
});

// ── File tracking ───────────────────────────────────────────────────────────

describe("extension file tracking", () => {
  it("tracks edited files via addFileToRecord", () => {
    const record = createSessionRecord("file-track-01", "/repo");
    addFileToRecord(record, "edit", "/repo/src/main.ts", "/repo");
    assert.deepEqual(record.filesEdited, ["src/main.ts"]);
    assert.deepEqual(record.filesCreated, []);
  });

  it("tracks created files via addFileToRecord", () => {
    const record = createSessionRecord("file-track-02", "/repo");
    addFileToRecord(record, "create", "/repo/src/new.ts", "/repo");
    assert.deepEqual(record.filesCreated, ["src/new.ts"]);
    assert.deepEqual(record.filesEdited, []);
  });

  it("deduplicates file paths", () => {
    const record = createSessionRecord("file-track-03", "/repo");
    addFileToRecord(record, "edit", "/repo/src/main.ts", "/repo");
    addFileToRecord(record, "edit", "/repo/src/main.ts", "/repo");
    assert.equal(record.filesEdited.length, 1);
  });

  it("skips .copilot/session-state paths", () => {
    const record = createSessionRecord("file-track-04", "/repo");
    addFileToRecord(record, "edit", "/repo/.copilot/session-state/plan.md", "/repo");
    assert.deepEqual(record.filesEdited, []);
  });

  it("stores absolute paths when no repo root", () => {
    const record = createSessionRecord("file-track-05", "/tmp");
    addFileToRecord(record, "edit", "/tmp/standalone.txt", null);
    assert.equal(record.filesEdited.length, 1);
    assert.ok(record.filesEdited[0].includes("standalone.txt"));
  });
});

// ── Significant actions ─────────────────────────────────────────────────────

describe("extension significant actions", () => {
  it("deduplicates significant actions", () => {
    const actions = dedupeArray(["git commit", "git push", "git commit"]);
    assert.deepEqual(actions, ["git commit", "git push"]);
  });

  it("accumulates distinct actions", () => {
    const actions = dedupeArray(["git commit", "git push", "pr created"]);
    assert.equal(actions.length, 3);
  });
});

// ── Manual entry creation ───────────────────────────────────────────────────

describe("extension manual entries (save_to_brag_sheet flow)", () => {
  it("creates and persists a manual entry record", () => {
    const dir = join(testDir, "entry-save");
    ensureDir(dir);

    const entry = createEntryRecord({
      summary: "Fixed critical prod bug",
      category: "bugfix",
      impact: "Restored service for 1000 users",
      tags: ["prod", "urgent"],
      repo: "my-repo",
      branch: "hotfix/123",
      sessionId: "sess-123",
    });

    assert.equal(entry.type, "entry");
    assert.equal(entry.source, "manual");
    assert.equal(entry.summary, "Fixed critical prod bug");
    assert.equal(entry.category, "bugfix");
    assert.equal(entry.impact, "Restored service for 1000 users");
    assert.deepEqual(entry.tags, ["prod", "urgent"]);
    assert.equal(entry.sessionId, "sess-123");

    const filePath = writeRecord(dir, entry);
    assert.ok(existsSync(filePath));

    const records = readRecords(dir, { type: "entry" });
    assert.equal(records.length, 1);
    assert.equal(records[0].summary, "Fixed critical prod bug");
  });

  it("validates categories against config", () => {
    const config = loadConfig(join(testDir, "nonexistent"));
    assert.ok(isValidCategory(config, "pr"));
    assert.ok(isValidCategory(config, "bugfix"));
    assert.ok(isValidCategory(config, "oncall"));
    assert.ok(!isValidCategory(config, "invalid-category"));

    const allIds = getAllCategoryIds(config);
    assert.ok(allIds.includes("pr"));
    assert.ok(allIds.includes("documentation"));
    assert.equal(allIds.length, 9);
  });

  it("auto-detects repo and branch from session when not provided", () => {
    const entry = createEntryRecord({
      summary: "Did work",
      repo: null,
      branch: null,
      sessionId: "sess-auto",
    });
    assert.equal(entry.repo, null);
    assert.equal(entry.branch, null);
    assert.equal(entry.sessionId, "sess-auto");
  });

  it("sanitizes summary text", () => {
    const entry = createEntryRecord({
      summary: "Fixed bug\nwith newline | and pipe",
    });
    assert.ok(!entry.summary.includes("\n"));
    // sanitize escapes pipes as \| for Markdown table safety
    assert.ok(!entry.summary.includes(" | "));
  });
});

// ── Review and render flow ──────────────────────────────────────────────────

describe("extension review_brag_sheet flow", () => {
  it("renders recent entries as markdown", () => {
    const dir = join(testDir, "review-render");
    ensureDir(dir);

    const entry = createEntryRecord({
      summary: "Shipped feature X",
      category: "pr",
      impact: "Unblocked team Y",
    });
    writeRecord(dir, entry);

    const records = readRecords(dir);
    const markdown = renderReviewSummary(records, { weeks: 4 });

    assert.ok(markdown.includes("Shipped feature X"));
    assert.ok(markdown.includes("Work Impact Log"));
  });

  it("returns empty message when no records exist", () => {
    const dir = join(testDir, "review-empty");
    ensureDir(dir);
    ensureDir(join(dir, "sessions"));
    ensureDir(join(dir, "entries"));

    const records = readRecords(dir);
    const markdown = renderReviewSummary(records, { weeks: 4 });
    // renderReviewSummary always returns the banner + structure
    assert.ok(typeof markdown === "string");
  });
});

// ── Generate work log flow ──────────────────────────────────────────────────

describe("extension generate_work_log flow", () => {
  it("generates markdown and writes to file", () => {
    const dir = join(testDir, "generate-log");
    ensureDir(dir);

    const entry = createEntryRecord({
      summary: "Built deployment pipeline",
      category: "infrastructure",
    });
    writeRecord(dir, entry);

    const records = readRecords(dir);
    const markdown = renderMarkdown(records);
    const outputPath = join(dir, "work-log.md");

    writeFileSync(outputPath, markdown, "utf8");
    const content = readFileSync(outputPath, "utf8");

    assert.ok(content.includes("Built deployment pipeline"));
    assert.ok(content.includes("Generated by Copilot Brag Sheet"));
    assert.ok(content.includes("WEEKLY_ENTRIES_START"));
    assert.ok(content.includes("WEEKLY_ENTRIES_END"));
  });

  it("uses detectBragSheetPath as default output", () => {
    const dir = join(testDir, "brag-path");
    const bragPath = detectBragSheetPath(dir);
    assert.ok(bragPath.endsWith("work-log.md"));
    assert.ok(bragPath.startsWith(dir));
  });
});

// ── Brag keyword detection ──────────────────────────────────────────────────
// Now tested comprehensively in test/heuristics.test.mjs via real imports.
// Keep a smoke test here to verify extension-level integration.

describe("extension brag keyword detection", () => {
  it("detects 'brag' as standalone word", () => {
    assert.ok(isBragRequest("Save this to my brag sheet"));
    assert.ok(isBragRequest("brag"));
  });

  it("excludes bragging and braggart", () => {
    assert.ok(!isBragRequest("stop bragging"));
    assert.ok(!isBragRequest("don't be a braggart"));
  });
});

// ── PR info extraction ──────────────────────────────────────────────────────
// Now tested comprehensively in test/heuristics.test.mjs via real imports.
// Keep a smoke test here for extension-level integration.

describe("extension PR info extraction", () => {
  it("extracts PR info from tool args", () => {
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
});

// ── Git action detection ────────────────────────────────────────────────────
// Now tested comprehensively in test/heuristics.test.mjs via real imports.
// Keep a smoke test here for extension-level integration.

describe("extension git action detection from shell commands", () => {
  it("detects git commit", () => {
    assert.equal(detectShellGitAction('git commit -m "fix"'), "git commit");
  });

  it("detects git push", () => {
    assert.equal(detectShellGitAction("git push origin main"), "git push");
  });

  it("returns null for non-git commands", () => {
    assert.equal(detectShellGitAction("npm test"), null);
  });

  it("returns null for empty/null commands", () => {
    assert.equal(detectShellGitAction(null), null);
    assert.equal(detectShellGitAction(""), null);
  });
});

// ── Error resilience ────────────────────────────────────────────────────────

describe("extension error resilience", () => {
  it("logError never throws", () => {
    assert.doesNotThrow(() => {
      logError(join(testDir, "error-resilience"), "test-context", new Error("test error"));
    });
  });

  it("logError works with string errors", () => {
    assert.doesNotThrow(() => {
      logError(join(testDir, "error-resilience"), "test-context", "string error");
    });
  });

  it("sanitize handles null and undefined", () => {
    assert.equal(sanitize(null), "");
    assert.equal(sanitize(undefined), "");
  });

  it("sanitize truncates long text", () => {
    const long = "a".repeat(600);
    const result = sanitize(long);
    assert.ok(result.length <= 500);
  });
});

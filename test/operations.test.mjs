/**
 * Tests for lib/operations.mjs — shared tool handler core logic.
 *
 * These test the unified "validate → create → persist → backup" operations
 * that both extension.mjs and mcp-server.mjs delegate to. Uses real disk
 * I/O with per-test temp dirs for isolation.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensureDir } from "../lib/paths.mjs";
import { loadConfig } from "../lib/config.mjs";
import { readRecords } from "../lib/storage.mjs";
import {
  saveBragEntry,
  reviewBragEntries,
  generateWorkLog,
} from "../lib/operations.mjs";

// ── Test fixtures ───────────────────────────────────────────────────────────

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), "ops-test-"));
});

after(() => {
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* noop */ }
});

function makeCtx(subdir) {
  const dataDir = join(testDir, subdir);
  ensureDir(dataDir);
  const config = loadConfig(dataDir);
  const gitConfig = { enabled: false, push: false };
  return { dataDir, config, gitConfig };
}

// ── saveBragEntry ───────────────────────────────────────────────────────────

describe("operations saveBragEntry", () => {
  it("saves a valid entry and returns ok: true", () => {
    const ctx = makeCtx("save-basic");
    const result = saveBragEntry({
      summary: "Fixed critical prod bug",
      category: "bugfix",
      impact: "Restored service for 1000 users",
      tags: ["prod", "urgent"],
      repo: "my-repo",
      branch: "hotfix/123",
      sessionId: "sess-123",
    }, ctx);

    assert.equal(result.ok, true);
    assert.ok(result.entry);
    assert.equal(result.entry.summary, "Fixed critical prod bug");
    assert.equal(result.entry.category, "bugfix");
    assert.ok(result.filePath);
    assert.ok(existsSync(result.filePath));
  });

  it("persists to disk and is readable", () => {
    const ctx = makeCtx("save-persist");
    saveBragEntry({ summary: "Shipped feature X" }, ctx);

    const records = readRecords(ctx.dataDir, { type: "entry" });
    assert.equal(records.length, 1);
    assert.equal(records[0].summary, "Shipped feature X");
  });

  it("returns ok: false for invalid category", () => {
    const ctx = makeCtx("save-bad-cat");
    const result = saveBragEntry({
      summary: "Did work",
      category: "nonexistent-category",
    }, ctx);

    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid_category");
    assert.ok(result.message.includes("nonexistent-category"));
    assert.ok(Array.isArray(result.validCategories));
    assert.ok(result.validCategories.includes("pr"));
  });

  it("returns ok: false for empty summary", () => {
    const ctx = makeCtx("save-empty");
    const result = saveBragEntry({ summary: "" }, ctx);

    assert.equal(result.ok, false);
    assert.equal(result.code, "empty_summary");
  });

  it("returns ok: false for whitespace-only summary", () => {
    const ctx = makeCtx("save-whitespace");
    const result = saveBragEntry({ summary: "   " }, ctx);

    assert.equal(result.ok, false);
    assert.equal(result.code, "empty_summary");
  });

  it("returns ok: false for newline/tab-only summary", () => {
    const ctx = makeCtx("save-tabs");
    const result = saveBragEntry({ summary: "\n\t" }, ctx);

    assert.equal(result.ok, false);
    assert.equal(result.code, "empty_summary");
  });

  it("saves without category (null)", () => {
    const ctx = makeCtx("save-no-cat");
    const result = saveBragEntry({ summary: "Generic work" }, ctx);

    assert.equal(result.ok, true);
    assert.equal(result.entry.category, null);
  });

  it("saves with tags array", () => {
    const ctx = makeCtx("save-tags");
    const result = saveBragEntry({
      summary: "Work with tags",
      tags: ["perf", "ci"],
    }, ctx);

    assert.equal(result.ok, true);
    assert.deepEqual(result.entry.tags, ["perf", "ci"]);
  });

  it("sanitizes summary text", () => {
    const ctx = makeCtx("save-sanitize");
    const result = saveBragEntry({
      summary: "Fixed bug\nwith newline | and pipe",
    }, ctx);

    assert.equal(result.ok, true);
    assert.ok(!result.entry.summary.includes("\n"));
  });
});

// ── reviewBragEntries ───────────────────────────────────────────────────────

describe("operations reviewBragEntries", () => {
  it("returns records and metadata", () => {
    const ctx = makeCtx("review-basic");
    saveBragEntry({ summary: "Entry 1", category: "pr" }, ctx);
    saveBragEntry({ summary: "Entry 2", category: "bugfix" }, ctx);

    const result = reviewBragEntries({ weeks: 4 }, ctx);

    assert.equal(result.ok, true);
    assert.equal(result.records.length, 2);
    assert.equal(result.weeks, 4);
    assert.ok(result.markdown);
    assert.ok(result.markdown.includes("Entry 1"));
  });

  it("returns empty results for no records", () => {
    const ctx = makeCtx("review-empty");
    ensureDir(join(ctx.dataDir, "entries"));

    const result = reviewBragEntries({ weeks: 4 }, ctx);

    assert.equal(result.ok, true);
    assert.equal(result.records.length, 0);
    assert.ok(typeof result.markdown === "string");
  });

  it("defaults to 4 weeks", () => {
    const ctx = makeCtx("review-default");
    const result = reviewBragEntries({}, ctx);

    assert.equal(result.ok, true);
    assert.equal(result.weeks, 4);
  });

  it("respects weeks parameter for filtering", () => {
    const ctx = makeCtx("review-filter");
    // Create an entry (it will be recent)
    saveBragEntry({ summary: "Recent entry" }, ctx);

    const result = reviewBragEntries({ weeks: 1 }, ctx);
    assert.equal(result.ok, true);
    assert.equal(result.records.length, 1);
  });
});

// ── generateWorkLog ─────────────────────────────────────────────────────────

describe("operations generateWorkLog", () => {
  it("generates markdown file and returns metadata", () => {
    const ctx = makeCtx("gen-basic");
    saveBragEntry({ summary: "Built deployment pipeline", category: "infrastructure" }, ctx);

    const outputPath = join(ctx.dataDir, "work-log.md");
    const result = generateWorkLog({ outputPath }, ctx);

    assert.equal(result.ok, true);
    assert.equal(result.outputPath, outputPath);
    assert.equal(result.recordCount, 1);
    assert.ok(result.bytesWritten > 0);
    assert.ok(existsSync(outputPath));

    const content = readFileSync(outputPath, "utf8");
    assert.ok(content.includes("Built deployment pipeline"));
    assert.ok(content.includes("WEEKLY_ENTRIES_START"));
  });

  it("uses default output path when omitted", () => {
    const ctx = makeCtx("gen-default");
    saveBragEntry({ summary: "Some work" }, ctx);

    const result = generateWorkLog({}, ctx);

    assert.equal(result.ok, true);
    assert.ok(result.outputPath.endsWith("work-log.md"));
    assert.ok(existsSync(result.outputPath));
  });

  it("handles zero records gracefully", () => {
    const ctx = makeCtx("gen-empty");
    const outputPath = join(ctx.dataDir, "work-log.md");
    const result = generateWorkLog({ outputPath }, ctx);

    assert.equal(result.ok, true);
    assert.equal(result.recordCount, 0);
    assert.ok(existsSync(outputPath));
  });
});

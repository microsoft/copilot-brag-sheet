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
import { readRecords, writeRecord } from "../lib/storage.mjs";
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
  it("saves a valid entry and returns ok: true", async () => {
    const ctx = makeCtx("save-basic");
    const result = await saveBragEntry({
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

  it("persists to disk and is readable", async () => {
    const ctx = makeCtx("save-persist");
    await saveBragEntry({ summary: "Shipped feature X" }, ctx);

    const records = readRecords(ctx.dataDir, { type: "entry" });
    assert.equal(records.length, 1);
    assert.equal(records[0].summary, "Shipped feature X");
  });

  it("returns ok: false for invalid category", async () => {
    const ctx = makeCtx("save-bad-cat");
    const result = await saveBragEntry({
      summary: "Did work",
      category: "nonexistent-category",
    }, ctx);

    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid_category");
    assert.ok(result.message.includes("nonexistent-category"));
    assert.ok(Array.isArray(result.validCategories));
    assert.ok(result.validCategories.includes("pr"));
  });

  it("returns ok: false for empty summary", async () => {
    const ctx = makeCtx("save-empty");
    const result = await saveBragEntry({ summary: "" }, ctx);

    assert.equal(result.ok, false);
    assert.equal(result.code, "empty_summary");
  });

  it("returns ok: false for whitespace-only summary", async () => {
    const ctx = makeCtx("save-whitespace");
    const result = await saveBragEntry({ summary: "   " }, ctx);

    assert.equal(result.ok, false);
    assert.equal(result.code, "empty_summary");
  });

  it("returns ok: false for newline/tab-only summary", async () => {
    const ctx = makeCtx("save-tabs");
    const result = await saveBragEntry({ summary: "\n\t" }, ctx);

    assert.equal(result.ok, false);
    assert.equal(result.code, "empty_summary");
  });

  it("saves without category (null)", async () => {
    const ctx = makeCtx("save-no-cat");
    const result = await saveBragEntry({ summary: "Generic work" }, ctx);

    assert.equal(result.ok, true);
    assert.equal(result.entry.category, null);
  });

  it("saves with tags array", async () => {
    const ctx = makeCtx("save-tags");
    const result = await saveBragEntry({
      summary: "Work with tags",
      tags: ["perf", "ci"],
    }, ctx);

    assert.equal(result.ok, true);
    assert.deepEqual(result.entry.tags, ["perf", "ci"]);
  });

  it("sanitizes summary text", async () => {
    const ctx = makeCtx("save-sanitize");
    const result = await saveBragEntry({
      summary: "Fixed bug\nwith newline | and pipe",
    }, ctx);

    assert.equal(result.ok, true);
    assert.ok(!result.entry.summary.includes("\n"));
  });

  it("deduplicates repeated saves in the same session", async () => {
    const ctx = makeCtx("save-idempotent-session");
    const args = {
      summary: "Recovered repository administration access",
      category: "investigation",
      repo: "example",
      sessionId: "session-retry",
    };

    const first = await saveBragEntry(args, ctx);
    const second = await saveBragEntry(args, ctx);

    assert.equal(first.ok, true);
    assert.equal(first.deduplicated, false);
    assert.equal(second.ok, true);
    assert.equal(second.deduplicated, true);
    assert.equal(second.entry.id, first.entry.id);
    assert.equal(readRecords(ctx.dataDir, { type: "entry" }).length, 1);
  });

  it("deduplicates concurrent saves with an explicit source key", async () => {
    const ctx = makeCtx("save-idempotent-key");
    const args = {
      summary: "Documented a migration decision",
      idempotencyKey: "session-123:source-event-456",
    };

    const results = await Promise.all([
      saveBragEntry(args, ctx),
      saveBragEntry(args, ctx),
    ]);

    assert.equal(results.filter((result) => result.deduplicated).length, 1);
    assert.equal(results[0].entry.id, results[1].entry.id);
    assert.equal(readRecords(ctx.dataDir, { type: "entry" }).length, 1);
  });
});

// ── reviewBragEntries ───────────────────────────────────────────────────────

describe("operations reviewBragEntries", () => {
  it("includes recent activity from a session that began in an old shard", () => {
    const ctx = makeCtx("review-resumed");
    ctx.config.output.includeSessionLog = true;
    const timestamp = new Date(Date.now() - 90 * 86400000).toISOString();
    writeRecord(ctx.dataDir, {
      id: "old-resumed", type: "session", timestamp,
      summary: "Recent resumed work", filesEdited: ["today.mjs"],
      capture: { lastEventAt: new Date().toISOString(), resumeCount: 1 },
    });
    const result = reviewBragEntries({ weeks: 4 }, ctx);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].timestamp, timestamp);
    assert.match(result.markdown, /Recent resumed work/);
  });

  it("returns records and metadata", async () => {
    const ctx = makeCtx("review-basic");
    await saveBragEntry({ summary: "Entry 1", category: "pr" }, ctx);
    await saveBragEntry({ summary: "Entry 2", category: "bugfix" }, ctx);

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

  it("respects weeks parameter for filtering", async () => {
    const ctx = makeCtx("review-filter");
    // Create an entry (it will be recent)
    await saveBragEntry({ summary: "Recent entry" }, ctx);

    const result = reviewBragEntries({ weeks: 1 }, ctx);
    assert.equal(result.ok, true);
    assert.equal(result.records.length, 1);
  });
});

// ── generateWorkLog ─────────────────────────────────────────────────────────

describe("operations generateWorkLog", () => {
  it("generates markdown file and returns metadata", async () => {
    const ctx = makeCtx("gen-basic");
    await saveBragEntry({ summary: "Built deployment pipeline", category: "infrastructure" }, ctx);

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

  it("uses default output path when omitted", async () => {
    const ctx = makeCtx("gen-default");
    await saveBragEntry({ summary: "Some work" }, ctx);

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

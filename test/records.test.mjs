import test from "node:test";
import assert from "node:assert/strict";

import {
  addFileToRecord,
  captureTaskDescription,
  createEntryRecord,
  createSessionRecord,
  dedupeArray,
  finalizeSessionRecord,
  isDelegatedSession,
  markCaptureEvent,
  resumeSessionRecord,
  sanitize,
  validateCategory,
  validateSessionId
} from "../lib/records.mjs";

test("createSessionRecord returns expected defaults", () => {
  const record = createSessionRecord("session-123", "C:\\repo");

  assert.equal(record.id, "session-123");
  assert.equal(record.type, "session");
  assert.equal(record.source, "copilot-cli");
  assert.equal(record.extensionVersion, null);
  assert.equal(record.sessionStartSource, null);
  assert.equal(record.endTime, null);
  assert.equal(record.repo, null);
  assert.equal(record.repoFull, null);
  assert.equal(record.branch, null);
  assert.equal(record.cwd, "C:\\repo");
  assert.deepEqual(record.filesEdited, []);
  assert.deepEqual(record.filesCreated, []);
  assert.deepEqual(record.prsCreated, []);
  assert.deepEqual(record.significantActions, []);
  assert.equal(record.summary, null);
  assert.equal(record.taskDescription, null);
  assert.equal(record.category, null);
  assert.deepEqual(record.tags, []);
  assert.equal(record.impact, null);
  assert.equal(record.status, "active");
  assert.equal(record.endReason, null);
  assert.deepEqual(record.delegatedSessionIds, []);
  assert.deepEqual(record.capture, {
    promptCount: 0,
    successfulToolCount: 0,
    failedToolCount: 0,
    errorCount: 0,
    recognizedToolCount: 0,
    compactionCount: 0,
    resumeCount: 0,
    lastEventAt: null,
    summarySource: null,
  });
  assert.equal(record.pid, process.pid);
  assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("markCaptureEvent records prompt and tool coverage without content", () => {
  const record = createSessionRecord("session-capture", "C:\\repo");

  markCaptureEvent(record, "prompt", {
    timestamp: "2026-09-17T20:00:00.000Z",
  });
  markCaptureEvent(record, "tool-success", {
    recognized: true,
    delegatedSessionId: "child-1",
    timestamp: "2026-09-17T20:01:00.000Z",
  });
  markCaptureEvent(record, "tool-failure", {
    delegatedSessionId: "child-1",
    timestamp: "2026-09-17T20:02:00.000Z",
  });
  markCaptureEvent(record, "error", {
    timestamp: "2026-09-17T20:03:00.000Z",
  });

  assert.deepEqual(record.capture, {
    promptCount: 1,
    successfulToolCount: 1,
    failedToolCount: 1,
    errorCount: 1,
    recognizedToolCount: 1,
    compactionCount: 0,
    resumeCount: 0,
    lastEventAt: "2026-09-17T20:03:00.000Z",
    summarySource: null,
  });
  assert.deepEqual(record.delegatedSessionIds, ["child-1"]);
});

test("captureTaskDescription records the initial prompt without overwriting it", () => {
  const record = createSessionRecord("session-prompt", "C:\\repo");

  captureTaskDescription(record, "Investigate the first issue", {
    timestamp: "2026-09-17T20:00:00.000Z",
  });
  captureTaskDescription(record, "Unrelated follow-up", {
    timestamp: "2026-09-17T20:01:00.000Z",
  });

  assert.equal(record.taskDescription, "Investigate the first issue");
  assert.equal(record.capture.promptCount, 2);
});

test("isDelegatedSession distinguishes child hooks from parent hooks", () => {
  assert.equal(isDelegatedSession("child-1", "parent-1"), true);
  assert.equal(isDelegatedSession("parent-1", "parent-1"), false);
  assert.equal(isDelegatedSession(undefined, "parent-1"), false);
});

test("finalizeSessionRecord persists a task fallback and incomplete status", () => {
  const record = createSessionRecord("session-finalize", "C:\\repo");
  record.taskDescription = "Investigate a capture regression";

  finalizeSessionRecord(record, {
    reason: "timeout",
    timestamp: "2026-09-17T20:03:00.000Z",
  });

  assert.equal(record.status, "incomplete");
  assert.equal(record.endReason, "timeout");
  assert.equal(record.endTime, "2026-09-17T20:03:00.000Z");
  assert.equal(record.summary, "Investigate a capture regression");
  assert.equal(record.capture.summarySource, "taskDescription");
});

test("resumeSessionRecord preserves evidence and reopens the same record", () => {
  const record = createSessionRecord("session-resume", "C:\\old");
  record.filesEdited = ["src/main.mjs"];
  record.status = "incomplete";
  record.endTime = "2026-09-17T20:00:00.000Z";

  resumeSessionRecord(record, {
    cwd: "C:\\new",
    pid: 1234,
    timestamp: "2026-09-17T21:00:00.000Z",
  });

  assert.equal(record.id, "session-resume");
  assert.equal(record.cwd, "C:\\new");
  assert.deepEqual(record.filesEdited, ["src/main.mjs"]);
  assert.equal(record.status, "active");
  assert.equal(record.endTime, null);
  assert.equal(record.capture.resumeCount, 1);
});

test("resumed finalization refreshes automatic summaries without re-escaping task text", () => {
  const record = createSessionRecord("summary-resume", "C:\\repo");
  captureTaskDescription(record, "Fix A | B");
  finalizeSessionRecord(record, { reason: "user_exit" });
  assert.equal(record.summary, record.taskDescription);
  resumeSessionRecord(record);
  finalizeSessionRecord(record, { reason: "complete", finalMessage: "Fixed A | B" });
  assert.equal(record.summary, "Fixed A \\| B");
  assert.equal(record.capture.summarySource, "finalMessage");

  resumeSessionRecord(record);
  finalizeSessionRecord(record, { reason: "complete", finalMessage: "Added regression coverage" });
  assert.equal(record.summary, "Added regression coverage");

  record.summary = "Explicit user summary";
  record.capture.summarySource = "existing";
  finalizeSessionRecord(record, { finalMessage: "Must not replace explicit summary" });
  assert.equal(record.summary, "Explicit user summary");
});

test("createEntryRecord generates UUID and sanitizes text", () => {
  const record = createEntryRecord({
    summary: "# shipped\nfeature | today",
    category: "pr",
    tags: ["release"],
    impact: "impact\nline",
    repo: "copilot-brag-sheet",
    branch: "main",
    sessionId: "session-123"
  });

  assert.equal(record.type, "entry");
  assert.equal(record.source, "manual");
  assert.match(record.id, /^[0-9a-f-]{36}$/i);
  assert.equal(record.summary, "shipped feature \\| today");
  assert.equal(record.category, "pr");
  assert.deepEqual(record.tags, ["release"]);
  assert.equal(record.impact, "impact line");
  assert.equal(record.repo, "copilot-brag-sheet");
  assert.equal(record.branch, "main");
  assert.equal(record.sessionId, "session-123");
  assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test("sanitize handles nullish, pipes, newlines, headings, reserved markers, truncation, and unicode", () => {
  assert.equal(sanitize(null), "");
  assert.equal(sanitize(undefined), "");
  assert.equal(sanitize("# Heading"), "Heading");
  assert.equal(sanitize("hello\r\nworld"), "hello world");
  assert.equal(sanitize("a|b"), "a\\|b");
  assert.equal(sanitize("WEEKLY_ENTRIES_START hello WEEKLY_ENTRIES_END"), "hello");
  assert.equal(sanitize("🚀 café"), "🚀 café");

  const longValue = `# ${"x".repeat(600)}`;
  assert.equal(sanitize(longValue).length, 500);
});

test("validateSessionId accepts safe IDs and rejects traversal", () => {
  assert.equal(validateSessionId("session_123-abc"), true);
  assert.throws(() => validateSessionId("../escape"), /Invalid session ID/);
  assert.throws(() => validateSessionId("space bad"), /Invalid session ID/);
});

test("validateCategory checks membership", () => {
  assert.equal(validateCategory("pr", ["pr", "bugfix"]), true);
  assert.equal(validateCategory("design", ["pr", "bugfix"]), false);
});

test("dedupeArray removes duplicates", () => {
  assert.deepEqual(dedupeArray(["a", "b", "a"]), ["a", "b"]);
});

test("addFileToRecord stores relative paths, dedupes, skips .copilot state, and normalizes separators", () => {
  const isWin = process.platform === "win32";
  const repoRoot = isWin ? "C:\\repo" : "/home/user/repo";
  const srcFile = isWin ? "C:\\repo\\src\\index.mjs" : "/home/user/repo/src/index.mjs";
  const testFile = isWin ? "C:\\repo\\test\\new.test.mjs" : "/home/user/repo/test/new.test.mjs";
  const copilotFile = isWin
    ? "C:\\Users\\testuser\\.copilot\\session-state\\abc\\plan.md"
    : "/home/user/.copilot/session-state/abc/plan.md";

  const record = createSessionRecord("session-456", repoRoot);

  addFileToRecord(record, "edit", srcFile, repoRoot);
  addFileToRecord(record, "edit", srcFile, repoRoot);
  addFileToRecord(record, "create", testFile, repoRoot);
  addFileToRecord(record, "edit", copilotFile, repoRoot);

  assert.deepEqual(record.filesEdited, ["src/index.mjs"]);
  assert.deepEqual(record.filesCreated, ["test/new.test.mjs"]);
});

test("addFileToRecord preserves absolute paths outside repo root", () => {
  const isWin = process.platform === "win32";
  const repoRoot = isWin ? "C:\\repo" : "/home/user/repo";
  const outsideFile = isWin ? "D:\\other\\file.txt" : "/tmp/other/file.txt";
  const expectedPath = isWin ? "D:/other/file.txt" : "/tmp/other/file.txt";

  const record = createSessionRecord("session-789", repoRoot);

  addFileToRecord(record, "edit", outsideFile, repoRoot);

  assert.deepEqual(record.filesEdited, [expectedPath]);
});

test("addFileToRecord resolves relative tool paths against the repository root", () => {
  const repoRoot = process.platform === "win32" ? "C:\\repo" : "/home/user/repo";
  const record = createSessionRecord("session-relative", repoRoot);

  addFileToRecord(record, "edit", "src/index.mjs", repoRoot);

  assert.deepEqual(record.filesEdited, ["src/index.mjs"]);
});

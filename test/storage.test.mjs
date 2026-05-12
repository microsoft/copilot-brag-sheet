import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  atomicWriteJSON,
  atomicWriteText,
  writeRecord,
  readRecords,
  updateRecord,
  logError,
} from "../lib/storage.mjs";

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "copilot-brag-sheet-storage-"));
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function writeJsonRecord(filePath, value) {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function makeRecord(overrides = {}) {
  return {
    id: overrides.id ?? "record-1",
    type: overrides.type ?? "session",
    source: overrides.source ?? "copilot-cli",
    timestamp: overrides.timestamp ?? "2025-03-15T10:30:00.000Z",
    summary: overrides.summary ?? "Did useful work",
    category: overrides.category ?? null,
    tags: overrides.tags ?? [],
    repo: overrides.repo ?? null,
    branch: overrides.branch ?? "main",
    ...overrides,
  };
}

test("atomicWriteJSON writes correct content and cleans temporary files", () => {
  const tempDir = makeTempDir();
  const filePath = join(tempDir, "record.json");
  const data = {
    message: "Hello 👋",
    large: "x".repeat(1024 * 1024),
  };

  atomicWriteJSON(filePath, data);

  assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), data);
  assert.deepEqual(
    readdirSync(tempDir).filter((name) => name.includes(".tmp.")),
    [],
  );
});

test("atomicWriteJSON preserves the original file when writing fails", () => {
  const tempDir = makeTempDir();
  const filePath = join(tempDir, "record.json");
  const original = { ok: true };
  const circular = {};
  circular.self = circular;

  writeFileSync(filePath, JSON.stringify(original, null, 2));

  assert.throws(() => atomicWriteJSON(filePath, circular));
  assert.deepEqual(JSON.parse(readFileSync(filePath, "utf8")), original);
  assert.deepEqual(
    readdirSync(tempDir).filter((name) => name.includes(".tmp.")),
    [],
  );
});

test("writeRecord writes session records to the year month shard", () => {
  const tempDir = makeTempDir();
  const record = makeRecord({
    id: "session-123",
    type: "session",
    timestamp: "2025-01-02T03:04:05.000Z",
  });

  const writtenPath = writeRecord(tempDir, record);

  assert.equal(
    writtenPath,
    join(tempDir, "sessions", "2025", "01", "2025-01-02T03-04-05.000Z_session-123.json"),
  );
  assert.deepEqual(JSON.parse(readFileSync(writtenPath, "utf8")), record);
});

test("writeRecord writes entry records under entries shards", () => {
  const tempDir = makeTempDir();
  const record = makeRecord({
    id: "entry-123",
    type: "entry",
    timestamp: "2025-02-03T04:05:06.000Z",
  });

  const writtenPath = writeRecord(tempDir, record);

  assert.equal(
    writtenPath,
    join(tempDir, "entries", "2025", "02", "2025-02-03T04-05-06.000Z_entry-123.json"),
  );
  assert.deepEqual(JSON.parse(readFileSync(writtenPath, "utf8")), record);
});

test("readRecords supports basic reads and filtering", () => {
  const tempDir = makeTempDir();
  const sessionRecord = makeRecord({
    id: "session-a",
    type: "session",
    timestamp: "2025-01-15T12:00:00.000Z",
    category: "tooling",
    repo: "copilot-brag-sheet",
    tags: ["cli", "tooling"],
  });
  const entryRecord = makeRecord({
    id: "entry-a",
    type: "entry",
    source: "manual",
    timestamp: "2025-02-20T12:00:00.000Z",
    category: "infrastructure",
    repo: "acme-dashboard",
    tags: ["dashboard", "migration"],
  });
  const laterRecord = makeRecord({
    id: "session-b",
    type: "session",
    timestamp: "2025-03-10T12:00:00.000Z",
    category: "tooling",
    repo: "copilot-brag-sheet",
    tags: ["release"],
  });

  writeRecord(tempDir, laterRecord);
  writeRecord(tempDir, sessionRecord);
  writeRecord(tempDir, entryRecord);

  assert.deepEqual(
    readRecords(tempDir).map((record) => record.id),
    ["session-a", "entry-a", "session-b"],
  );
  assert.deepEqual(
    readRecords(tempDir, {
      since: "2025-02-01T00:00:00.000Z",
      until: "2025-02-28T23:59:59.999Z",
    }).map((record) => record.id),
    ["entry-a"],
  );
  assert.deepEqual(
    readRecords(tempDir, { category: "tooling" }).map((record) => record.id),
    ["session-a", "session-b"],
  );
  assert.deepEqual(
    readRecords(tempDir, { repo: "acme-dashboard" }).map((record) => record.id),
    ["entry-a"],
  );
  assert.deepEqual(
    readRecords(tempDir, { tags: ["migration", "missing"] }).map((record) => record.id),
    ["entry-a"],
  );
  assert.deepEqual(
    readRecords(tempDir, { type: "entry" }).map((record) => record.id),
    ["entry-a"],
  );
});

test("readRecords returns an empty array for empty directories", () => {
  const tempDir = makeTempDir();

  assert.deepEqual(readRecords(tempDir), []);
});

test("readRecords skips non json files", () => {
  const tempDir = makeTempDir();
  const record = makeRecord({
    id: "session-valid",
    timestamp: "2025-04-01T00:00:00.000Z",
  });
  const shardDir = join(tempDir, "sessions", "2025", "04");

  ensureDir(shardDir);
  writeRecord(tempDir, record);
  writeFileSync(join(shardDir, "ignore.txt"), "skip me");

  assert.deepEqual(
    readRecords(tempDir).map((item) => item.id),
    ["session-valid"],
  );
});

test("updateRecord merges fields and preserves existing values", async () => {
  const tempDir = makeTempDir();
  const original = makeRecord({
    id: "session-update",
    timestamp: "2025-05-05T05:05:05.000Z",
    summary: "Initial summary",
    category: null,
    tags: [],
    repo: "copilot-brag-sheet",
  });
  const writtenPath = writeRecord(tempDir, original);

  const updated = await updateRecord(tempDir, "session-update", {
    summary: "Updated summary",
    category: "tooling",
    tags: ["ship"],
  });

  assert.equal(updated.summary, "Updated summary");
  assert.equal(updated.category, "tooling");
  assert.deepEqual(updated.tags, ["ship"]);
  assert.equal(updated.repo, "copilot-brag-sheet");

  const persisted = JSON.parse(readFileSync(writtenPath, "utf8"));
  assert.equal(persisted.summary, "Updated summary");
  assert.equal(persisted.category, "tooling");
  assert.deepEqual(persisted.tags, ["ship"]);
  assert.equal(persisted.repo, "copilot-brag-sheet");
});

test("logError appends messages and never throws", () => {
  const tempDir = makeTempDir();
  const errorLogPath = join(tempDir, "errors.log");

  assert.doesNotThrow(() => {
    logError(tempDir, "save", new Error("first failure"));
    logError(tempDir, "render", new Error("second failure"));
  });

  assert.equal(existsSync(errorLogPath), true);

  const lines = readFileSync(errorLogPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /\] save: first failure$/);
  assert.match(lines[1], /\] render: second failure$/);
});

test("readRecords ignores files outside the requested shard range", () => {
  const tempDir = makeTempDir();
  writeJsonRecord(
    join(tempDir, "sessions", "2024", "12", "2024-12-15T00-00-00.000Z_old.json"),
    makeRecord({ id: "old", timestamp: "2024-12-15T00:00:00.000Z" }),
  );
  writeJsonRecord(
    join(tempDir, "sessions", "2025", "01", "2025-01-10T00-00-00.000Z_match.json"),
    makeRecord({ id: "match", timestamp: "2025-01-10T00:00:00.000Z" }),
  );
  writeJsonRecord(
    join(tempDir, "sessions", "2025", "03", "2025-03-10T00-00-00.000Z_new.json"),
    makeRecord({ id: "new", timestamp: "2025-03-10T00:00:00.000Z" }),
  );

  assert.deepEqual(
    readRecords(tempDir, {
      since: "2025-01-01T00:00:00.000Z",
      until: "2025-01-31T23:59:59.999Z",
    }).map((record) => record.id),
    ["match"],
  );
});

test("atomicWriteText writes correct content and cleans temporary files", () => {
  const tempDir = makeTempDir();
  const filePath = join(tempDir, "test-output.md");

  atomicWriteText(filePath, "# Hello\n\nSome markdown content.");

  assert.ok(existsSync(filePath));
  assert.equal(readFileSync(filePath, "utf8"), "# Hello\n\nSome markdown content.");

  // No stale tmp file left behind
  const files = readdirSync(tempDir);
  assert.ok(!files.some(f => f.includes(".tmp.")));
});

test("atomicWriteText overwrites existing file atomically", () => {
  const tempDir = makeTempDir();
  const filePath = join(tempDir, "overwrite.md");

  atomicWriteText(filePath, "version 1");
  assert.equal(readFileSync(filePath, "utf8"), "version 1");

  atomicWriteText(filePath, "version 2");
  assert.equal(readFileSync(filePath, "utf8"), "version 2");
});

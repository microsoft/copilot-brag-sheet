import { join, dirname, basename } from "node:path";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  appendFileSync,
} from "node:fs";
import { withFileLock } from "./lock.mjs";
import { recordActivityTimestamp } from "./records.mjs";

const TYPE_TO_SUBDIR = {
  session: "sessions",
  entry: "entries",
};

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function getShardParts(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${timestamp}`);
  }

  return {
    year: `${date.getUTCFullYear()}`,
    month: `${date.getUTCMonth() + 1}`.padStart(2, "0"),
  };
}

function toFileTimestamp(timestamp) {
  return String(timestamp).replaceAll(":", "-");
}

function getRecordPath(dataDir, record) {
  const subdir = TYPE_TO_SUBDIR[record?.type];

  if (!subdir) {
    throw new Error(`Unsupported record type: ${record?.type}`);
  }

  if (!record?.id) {
    throw new Error("Record id is required");
  }

  const { year, month } = getShardParts(record.timestamp);
  const shardDir = join(dataDir, subdir, year, month);
  const fileName = `${toFileTimestamp(record.timestamp)}_${record.id}.json`;

  return {
    shardDir,
    filePath: join(shardDir, fileName),
  };
}

function getSelectedSubdirs(type = "all") {
  if (type === "all") {
    return ["sessions", "entries"];
  }

  const subdir = TYPE_TO_SUBDIR[type];

  if (!subdir) {
    throw new Error(`Unsupported record type filter: ${type}`);
  }

  return [subdir];
}

function toShardKey(year, month) {
  return Number.parseInt(`${year}${month}`, 10);
}

function getShardBounds(options = {}) {
  const sinceDate = options.since ? new Date(options.since) : null;
  const untilDate = options.until ? new Date(options.until) : null;

  if (sinceDate && Number.isNaN(sinceDate.getTime())) {
    throw new Error(`Invalid since date: ${options.since}`);
  }

  if (untilDate && Number.isNaN(untilDate.getTime())) {
    throw new Error(`Invalid until date: ${options.until}`);
  }

  return {
    sinceMs: sinceDate ? sinceDate.getTime() : Number.NEGATIVE_INFINITY,
    untilMs: untilDate ? untilDate.getTime() : Number.POSITIVE_INFINITY,
    minShard: sinceDate
      ? toShardKey(sinceDate.getUTCFullYear(), `${sinceDate.getUTCMonth() + 1}`.padStart(2, "0"))
      : Number.NEGATIVE_INFINITY,
    maxShard: untilDate
      ? toShardKey(untilDate.getUTCFullYear(), `${untilDate.getUTCMonth() + 1}`.padStart(2, "0"))
      : Number.POSITIVE_INFINITY,
  };
}

function matchesFilters(record, options, bounds) {
  const timestampMs = new Date(recordActivityTimestamp(record)).getTime();

  if (Number.isNaN(timestampMs)) {
    return false;
  }

  if (timestampMs < bounds.sinceMs || timestampMs > bounds.untilMs) {
    return false;
  }

  if (options.type && options.type !== "all" && record.type !== options.type) {
    return false;
  }

  if (options.category && record.category !== options.category) {
    return false;
  }

  if (options.repo && record.repo !== options.repo) {
    return false;
  }

  if (options.tags?.length) {
    const recordTags = Array.isArray(record.tags) ? record.tags : [];

    if (!options.tags.some((tag) => recordTags.includes(tag))) {
      return false;
    }
  }

  return true;
}

function recordActivityTime(record) {
  const value = recordActivityTimestamp(record);
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function recordStartTime(record) {
  const time = new Date(record?.timestamp).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function mergeRecordVersions(left, right) {
  const newer = recordActivityTime(right) >= recordActivityTime(left) ? right : left;
  const older = newer === right ? left : right;

  if (newer.type !== "session") return newer;

  const mergeArray = (first, second, key = (value) => JSON.stringify(value)) => {
    const values = [...(first || []), ...(second || [])];
    return [...new Map(values.map((value) => [key(value), value])).values()];
  };
  const olderCapture = older.capture || {};
  const newerCapture = newer.capture || {};
  const hasCapture = Boolean(older.capture || newer.capture);
  const captureFields = [
    "promptCount",
    "successfulToolCount",
    "failedToolCount",
    "errorCount",
    "recognizedToolCount",
    "compactionCount",
    "resumeCount",
  ];
  const capture = hasCapture ? { ...olderCapture, ...newerCapture } : undefined;
  if (capture) {
    for (const field of captureFields) {
      capture[field] = Math.max(olderCapture[field] || 0, newerCapture[field] || 0);
    }
  }

  return {
    ...older,
    ...newer,
    timestamp: recordStartTime(left) <= recordStartTime(right)
      ? left.timestamp
      : right.timestamp,
    repo: newer.repo || older.repo || null,
    repoFull: newer.repoFull || older.repoFull || null,
    branch: newer.branch || older.branch || null,
    summary: newer.summary || older.summary || null,
    taskDescription: newer.taskDescription || older.taskDescription || null,
    filesEdited: mergeArray(older.filesEdited, newer.filesEdited, String),
    filesCreated: mergeArray(older.filesCreated, newer.filesCreated, String),
    prsCreated: mergeArray(
      older.prsCreated,
      newer.prsCreated,
      (value) => `${value?.repo || ""}:${value?.id || ""}:${value?.title || ""}`,
    ),
    significantActions: mergeArray(
      older.significantActions,
      newer.significantActions,
      String,
    ),
    delegatedSessionIds: mergeArray(
      older.delegatedSessionIds,
      newer.delegatedSessionIds,
      String,
    ),
    capture,
  };
}

function listJsonFiles(rootDir, bounds) {
  if (!existsSync(rootDir)) {
    return [];
  }

  const filePaths = [];

  for (const yearEntry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!yearEntry.isDirectory() || !/^\d{4}$/.test(yearEntry.name)) {
      continue;
    }

    const yearDir = join(rootDir, yearEntry.name);

    for (const monthEntry of readdirSync(yearDir, { withFileTypes: true })) {
      if (!monthEntry.isDirectory() || !/^\d{2}$/.test(monthEntry.name)) {
        continue;
      }

      const shardKey = toShardKey(yearEntry.name, monthEntry.name);

      if (shardKey < bounds.minShard || shardKey > bounds.maxShard) {
        continue;
      }

      const monthDir = join(yearDir, monthEntry.name);

      for (const fileEntry of readdirSync(monthDir, { withFileTypes: true })) {
        if (fileEntry.isFile() && fileEntry.name.endsWith(".json")) {
          filePaths.push(join(monthDir, fileEntry.name));
        }
      }
    }
  }

  return filePaths;
}

function findRecordFiles(dataDir, recordId, type = "all") {
  const matches = [];

  for (const subdir of getSelectedSubdirs(type)) {
    const rootDir = join(dataDir, subdir);

    if (!existsSync(rootDir)) {
      continue;
    }

    for (const yearEntry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!yearEntry.isDirectory()) {
        continue;
      }

      const yearDir = join(rootDir, yearEntry.name);

      for (const monthEntry of readdirSync(yearDir, { withFileTypes: true })) {
        if (!monthEntry.isDirectory()) {
          continue;
        }

        const monthDir = join(yearDir, monthEntry.name);

        for (const fileEntry of readdirSync(monthDir, { withFileTypes: true })) {
          if (!fileEntry.isFile() || !fileEntry.name.endsWith(".json")) {
            continue;
          }

          if (basename(fileEntry.name).endsWith(`_${recordId}.json`)) {
            matches.push(join(monthDir, fileEntry.name));
          }
        }
      }
    }
  }

  return matches.sort();
}

function findRecordFile(dataDir, recordId, type = "all") {
  return findRecordFiles(dataDir, recordId, type).at(-1) || null;
}

export function atomicWriteJSON(filePath, data) {
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  let fd;

  try {
    fd = openSync(tmpPath, "w");
    writeFileSync(fd, JSON.stringify(data, null, 2));
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmpPath, filePath);
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Best effort cleanup.
      }
    }

    try {
      unlinkSync(tmpPath);
    } catch {
      // Best effort cleanup.
    }

    throw error;
  }
}

export function writeRecord(dataDir, record) {
  const { shardDir, filePath } = getRecordPath(dataDir, record);
  ensureDir(shardDir);
  atomicWriteJSON(filePath, record);
  return filePath;
}

export function readRecord(dataDir, recordId, type = "all") {
  let record = null;
  for (const recordPath of findRecordFiles(dataDir, recordId, type)) {
    const version = JSON.parse(readFileSync(recordPath, "utf8"));
    record = record ? mergeRecordVersions(record, version) : version;
  }
  return record;
}

export async function writeRecordOnce(dataDir, record) {
  const lockDir = join(dataDir, ".locks");
  ensureDir(lockDir);
  const lockPath = join(lockDir, `${record.type}-${record.id}.lock`);

  return withFileLock(lockPath, async () => {
    const existingPath = findRecordFile(dataDir, record.id, record.type);
    if (existingPath) {
      return {
        created: false,
        record: JSON.parse(readFileSync(existingPath, "utf8")),
        filePath: existingPath,
      };
    }

    return {
      created: true,
      record,
      filePath: writeRecord(dataDir, record),
    };
  });
}

export function readRecords(dataDir, options = {}) {
  const bounds = getShardBounds(options);
  const recordsById = new Map();
  const recordsWithoutId = [];

  for (const subdir of getSelectedSubdirs(options.type ?? "all")) {
    const rootDir = join(dataDir, subdir);

    // Resumed sessions retain their original shard; all versions must be merged
    // before filtering on their current activity and metadata.
    const shardBounds = subdir === "sessions" ? getShardBounds() : bounds;
    for (const filePath of listJsonFiles(rootDir, shardBounds)) {
      let record;

      try {
        record = JSON.parse(readFileSync(filePath, "utf8"));
      } catch {
        continue;
      }

      if (!record || typeof record !== "object") continue;
      if (!record.id) {
        recordsWithoutId.push(record);
        continue;
      }

      const key = `${record.type || "unknown"}:${record.id}`;
      const existing = recordsById.get(key);
      recordsById.set(
        key,
        existing ? mergeRecordVersions(existing, record) : record,
      );
    }
  }

  const records = [...recordsById.values(), ...recordsWithoutId]
    .filter(record => matchesFilters(record, options, bounds));
  records.sort((left, right) => {
    const leftMs = new Date(recordActivityTimestamp(left)).getTime();
    const rightMs = new Date(recordActivityTimestamp(right)).getTime();
    return leftMs - rightMs;
  });

  return records;
}

export async function updateRecord(dataDir, recordId, updates) {
  const recordPath = findRecordFile(dataDir, recordId);

  if (!recordPath) {
    throw new Error(`Record not found: ${recordId}`);
  }

  const lockPath = join(dirname(recordPath), `${basename(recordPath)}.lock`);

  return withFileLock(lockPath, async () => {
    const current = readRecord(dataDir, recordId);
    const next = {
      ...current,
      ...updates,
    };

    atomicWriteJSON(recordPath, next);
    return next;
  });
}

export function logError(dataDir, context, error) {
  try {
    ensureDir(dataDir);
    const message = error instanceof Error ? error.message : String(error);
    appendFileSync(join(dataDir, "errors.log"), `[${new Date().toISOString()}] ${context}: ${message}\n`);
  } catch {
    // Never throw from logging.
  }
}

export function atomicWriteText(filePath, text) {
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  let fd;
  try {
    fd = openSync(tmpPath, "w");
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmpPath, filePath);
  } catch (error) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* noop */ }
    }
    try { unlinkSync(tmpPath); } catch { /* noop */ }
    throw error;
  }
}

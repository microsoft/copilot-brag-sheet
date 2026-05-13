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
  const timestampMs = new Date(record.timestamp).getTime();

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

function findRecordFile(dataDir, recordId) {
  for (const subdir of getSelectedSubdirs("all")) {
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
            return join(monthDir, fileEntry.name);
          }
        }
      }
    }
  }

  return null;
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

export function readRecords(dataDir, options = {}) {
  const bounds = getShardBounds(options);
  const records = [];

  for (const subdir of getSelectedSubdirs(options.type ?? "all")) {
    const rootDir = join(dataDir, subdir);

    for (const filePath of listJsonFiles(rootDir, bounds)) {
      let record;

      try {
        record = JSON.parse(readFileSync(filePath, "utf8"));
      } catch {
        continue;
      }

      if (matchesFilters(record, options, bounds)) {
        records.push(record);
      }
    }
  }

  records.sort((left, right) => {
    const leftMs = new Date(left.timestamp).getTime();
    const rightMs = new Date(right.timestamp).getTime();
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
    const current = JSON.parse(readFileSync(recordPath, "utf8"));
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

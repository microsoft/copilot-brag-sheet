import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const RESERVED_MARKERS = ["WEEKLY_ENTRIES_START", "WEEKLY_ENTRIES_END"];
const SESSION_STATE_SEGMENT = ".copilot/session-state";

export function createSessionRecord(sessionId, cwd) {
  validateSessionId(sessionId);

  return {
    id: sessionId,
    type: "session",
    source: "copilot-cli",
    extensionVersion: null,
    sessionStartSource: null,
    timestamp: new Date().toISOString(),
    endTime: null,
    endReason: null,
    repo: null,
    repoFull: null,
    branch: null,
    cwd: cwd || process.cwd(),
    filesEdited: [],
    filesCreated: [],
    prsCreated: [],
    significantActions: [],
    delegatedSessionIds: [],
    summary: null,
    taskDescription: null,
    category: null,
    tags: [],
    impact: null,
    status: "active",
    pid: process.pid,
    capture: {
      promptCount: 0,
      successfulToolCount: 0,
      failedToolCount: 0,
      errorCount: 0,
      recognizedToolCount: 0,
      compactionCount: 0,
      resumeCount: 0,
      lastEventAt: null,
      summarySource: null,
    },
  };
}

export function createEntryRecord(args = {}) {
  const dedupeKey = args.idempotencyKey
    ? createHash("sha256").update(String(args.idempotencyKey)).digest("hex")
    : null;

  const record = {
    id: dedupeKey ? uuidFromHash(dedupeKey) : randomUUID(),
    type: "entry",
    source: "manual",
    timestamp: new Date().toISOString(),
    summary: sanitize(args.summary),
    category: args.category || null,
    tags: Array.isArray(args.tags) ? [...args.tags] : [],
    impact: args.impact ? sanitize(args.impact) : null,
    repo: args.repo || null,
    branch: args.branch || null,
    sessionId: args.sessionId || null,
  };

  if (dedupeKey) record.dedupeKey = dedupeKey;
  return record;
}

function ensureCaptureState(record) {
  record.capture = {
    promptCount: 0,
    successfulToolCount: 0,
    failedToolCount: 0,
    errorCount: 0,
    recognizedToolCount: 0,
    compactionCount: 0,
    resumeCount: 0,
    lastEventAt: null,
    summarySource: null,
    ...(record.capture || {}),
  };
  record.delegatedSessionIds = dedupeArray(record.delegatedSessionIds);
  return record.capture;
}

function toIsoTimestamp(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function uuidFromHash(hash) {
  const chars = hash.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function markCaptureEvent(record, kind, options = {}) {
  const capture = ensureCaptureState(record);

  if (kind === "prompt") capture.promptCount += 1;
  if (kind === "tool-success") capture.successfulToolCount += 1;
  if (kind === "tool-failure") capture.failedToolCount += 1;
  if (kind === "error") capture.errorCount += 1;
  if (kind === "compaction") capture.compactionCount += 1;
  if (options.recognized) capture.recognizedToolCount += 1;
  if (options.delegatedSessionId) {
    record.delegatedSessionIds = dedupeArray([
      ...record.delegatedSessionIds,
      options.delegatedSessionId,
    ]);
  }

  capture.lastEventAt = toIsoTimestamp(options.timestamp);
  return record;
}

export function captureTaskDescription(record, prompt, options = {}) {
  markCaptureEvent(record, "prompt", options);
  if (!record.taskDescription && prompt) {
    record.taskDescription = sanitize(prompt);
  }
  return record;
}

export function isDelegatedSession(inputSessionId, parentSessionId) {
  return Boolean(
    inputSessionId
    && parentSessionId
    && inputSessionId !== parentSessionId,
  );
}

export function resumeSessionRecord(record, options = {}) {
  const capture = ensureCaptureState(record);
  record.cwd = options.cwd || record.cwd;
  record.pid = options.pid || process.pid;
  record.status = "active";
  record.endTime = null;
  record.endReason = null;
  capture.resumeCount += 1;
  capture.lastEventAt = toIsoTimestamp(options.timestamp);
  return record;
}

export function finalizeSessionRecord(record, options = {}) {
  const capture = ensureCaptureState(record);
  const reason = options.reason || "complete";

  record.status = ["complete", "user_exit"].includes(reason)
    ? "finalized"
    : "incomplete";
  record.endReason = reason;
  record.endTime = toIsoTimestamp(options.timestamp);

  const automaticSummary = ["finalMessage", "taskDescription"].includes(capture.summarySource);
  if ((!record.summary || automaticSummary) && options.finalMessage) {
    record.summary = sanitize(options.finalMessage);
    capture.summarySource = "finalMessage";
  } else if (!record.summary && record.taskDescription) {
    record.summary = record.taskDescription;
    capture.summarySource = "taskDescription";
  } else if (record.summary && !capture.summarySource) {
    capture.summarySource = "existing";
  }

  capture.lastEventAt = record.endTime;
  return record;
}

export function recordActivityTimestamp(record) {
  return record?.type === "session"
    ? record.capture?.lastEventAt || record.endTime || record.timestamp
    : record?.timestamp;
}

export function sanitize(text) {
  if (text === null || text === undefined) {
    return "";
  }

  let value = String(text);
  value = value.replace(/\r?\n/g, " ");

  for (const marker of RESERVED_MARKERS) {
    value = value.replaceAll(marker, "");
  }

  value = value.replace(/^\s*#+\s*/u, "");
  value = value.replace(/\|/g, "\\|");
  value = value.trim();

  if (value.length > 500) {
    value = value.slice(0, 500).trim();
  }

  return value;
}

export function validateSessionId(id) {
  if (!/^[\w-]+$/u.test(id)) {
    throw new Error("Invalid session ID");
  }

  return true;
}

export function validateCategory(category, validIds) {
  return Array.isArray(validIds) && validIds.includes(category);
}

export function dedupeArray(arr) {
  return [...new Set(Array.isArray(arr) ? arr : [])];
}

export function addFileToRecord(record, toolName, filePath, repoRoot) {
  if (!record || !filePath) {
    return record;
  }

  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(repoRoot || process.cwd(), filePath);
  const normalizedAbsolute = normalizePath(absolutePath).toLowerCase();
  if (normalizedAbsolute.includes(SESSION_STATE_SEGMENT)) {
    return record;
  }

  const targetKey = String(toolName || "").toLowerCase().includes("create")
    ? "filesCreated"
    : "filesEdited";

  const normalizedRepoRoot = repoRoot ? path.resolve(repoRoot) : null;
  let finalPath = absolutePath;

  if (normalizedRepoRoot) {
    const relativePath = path.relative(normalizedRepoRoot, absolutePath);
    if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
      finalPath = relativePath;
    }
  }

  record[targetKey] = dedupeArray([...(record[targetKey] || []), normalizePath(finalPath)]);
  return record;
}

function normalizePath(filePath) {
  return String(filePath).replace(/[\\/]+/g, "/");
}

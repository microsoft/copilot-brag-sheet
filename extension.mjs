/**
 * @fileoverview Copilot Brag Sheet — Copilot CLI Extension
 *
 * Automatically tracks Copilot CLI sessions into structured JSON records
 * and provides tools for maintaining a personal work impact log.
 * Local-first, cross-platform (Windows/macOS/Linux), Node 18+.
 *
 * @license MIT
 * @see https://github.com/microsoft/copilot-brag-sheet
 */

import { joinSession } from "@github/copilot-sdk/extension";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  existsSync as fileExists,
  readFileSync as readFile,
  unlinkSync,
} from "node:fs";

import {
  detectDataDir,
  detectGitConfig,
  ensureDir,
  resolveHookWorkingDirectory,
} from "./lib/paths.mjs";
import { loadConfig, getAllCategoryIds, buildUserContext } from "./lib/config.mjs";
import {
  writeRecord, readRecord, readRecords, updateRecord, logError,
} from "./lib/storage.mjs";
import { ensureGitRepo, addRemote } from "./lib/git-backup.mjs";
import {
  createSessionRecord,
  addFileToRecord,
  captureTaskDescription,
  finalizeSessionRecord,
  isDelegatedSession,
  markCaptureEvent,
  resumeSessionRecord,
  dedupeArray,
} from "./lib/records.mjs";
import { isBragRequest, classifyToolUse } from "./lib/heuristics.mjs";
import {
  saveBragEntry, reviewBragEntries, generateWorkLog,
} from "./lib/operations.mjs";

// Debug: log to stderr at module load time so we can verify the host actually loaded us.
// Gated on env var to avoid noise in normal sessions. Set BRAG_SHEET_DEBUG=1 to enable.
if (process.env.BRAG_SHEET_DEBUG) {
  process.stderr.write("[brag-sheet] extension module loaded\n");
}

let extensionVersion = "unknown";
try {
  extensionVersion = JSON.parse(
    readFile(new URL("./package.json", import.meta.url), "utf8"),
  ).version || "unknown";
} catch { /* best effort */ }

// ── Module-level state (one session per extension process) ──────────────────

let dataDir = null;
let config = null;
let gitConfig = null;
let sessionRecord = null;

// ── Helpers ─────────────────────────────────────────────────────────────────

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function detectRepoInfo(cwd) {
  const root = git(["rev-parse", "--show-toplevel"], cwd);
  if (!root) return { repoRoot: null, repo: null, repoFull: null, branch: null };

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const remote = git(["remote", "get-url", "origin"], cwd);

  let repo = path.basename(root);
  let repoFull = null;
  if (remote) {
    const m = remote.match(/[/:]([^/]+\/[^/.]+?)(?:\.git)?$/);
    if (m) {
      repoFull = m[1];
      repo = repoFull.split("/").pop();
    }
  }

  return { repoRoot: root, repo, repoFull, branch };
}

async function recoverOrphans(dir) {
  const STALE_MS = 5 * 60 * 1000;
  const now = Date.now();
  let records;
  try {
    records = readRecords(dir, { type: "session" });
  } catch {
    return;
  }

  for (const record of records) {
    if (record.status !== "active") continue;
    if (isProcessAlive(record.pid)) continue;
    if (now - new Date(record.timestamp).getTime() < STALE_MS) continue;

    try {
      await updateRecord(dir, record.id, {
        status: "orphaned",
        endTime: new Date().toISOString(),
      });
    } catch { /* best effort */ }
  }
}

/** Lazy-init dataDir, config, and gitConfig if onSessionStart failed. */
function ensureInitialized() {
  if (!dataDir) {
    dataDir = detectDataDir();
    ensureDir(dataDir);
  }
  if (!config) {
    config = loadConfig(dataDir);
  }
  if (!gitConfig) {
    gitConfig = detectGitConfig();
  }
}

function eventTimestamp(input) {
  const timestamp = input?.timestamp ? new Date(input.timestamp) : new Date();
  return Number.isNaN(timestamp.getTime())
    ? new Date().toISOString()
    : timestamp.toISOString();
}

function isDelegatedHook(input, invocation) {
  return isDelegatedSession(input?.sessionId, invocation?.sessionId);
}

function persistSessionRecord() {
  // Keep the live object until the file lock is acquired. A captured partial
  // snapshot can overwrite newer hook events or a synchronous shutdown save.
  return updateRecord(dataDir, sessionRecord.id, sessionRecord);
}

// Tool classification sets and helpers are now in lib/heuristics.mjs

// ── Extension entry point ───────────────────────────────────────────────────

const session = await joinSession({
  hooks: {
    onSessionStart: async (input, invocation) => {
      if (process.env.BRAG_SHEET_DEBUG) {
        process.stderr.write("[brag-sheet] onSessionStart called\n");
      }
      try {
        dataDir = detectDataDir();
        ensureDir(dataDir);
        config = loadConfig(dataDir);
        // Let env vars override config.json for backward compat
        const envGitConfig = detectGitConfig();
        gitConfig = envGitConfig.enabled ? envGitConfig : (config?.git ?? { enabled: false, push: false });

        // Initialize git repo in data dir if enabled
        if (gitConfig.enabled) {
          ensureGitRepo(dataDir).then(async (initialized) => {
            if (!initialized) return;
            // Pick up pending remote from install script
            const pendingFile = path.join(dataDir, ".git-remote-pending");
            if (fileExists(pendingFile)) {
              try {
                const url = readFile(pendingFile, "utf8").trim();
                if (url) {
                  await addRemote(dataDir, url);
                }
                unlinkSync(pendingFile);
              } catch { /* best effort */ }
            }
          }).catch((e) =>
            logError(dataDir, "git-init", e),
          );
        }

        const workingDirectory = resolveHookWorkingDirectory(input);
        const existing = sessionRecord?.id === invocation.sessionId
          ? sessionRecord
          : readRecord(dataDir, invocation.sessionId, "session");

        if (isDelegatedHook(input, invocation)) {
          sessionRecord = existing
            || sessionRecord
            || createSessionRecord(invocation.sessionId, process.cwd());
          sessionRecord.extensionVersion = extensionVersion;
          markCaptureEvent(sessionRecord, "subagent", {
            delegatedSessionId: input.sessionId,
            timestamp: eventTimestamp(input),
          });

          if (existing) {
            await persistSessionRecord();
          } else {
            writeRecord(dataDir, sessionRecord);
          }
          return;
        }

        const info = detectRepoInfo(workingDirectory);
        if (existing?.type === "session") {
          sessionRecord = resumeSessionRecord(existing, {
            cwd: workingDirectory,
            pid: process.pid,
            timestamp: eventTimestamp(input),
          });
        } else {
          sessionRecord = createSessionRecord(invocation.sessionId, workingDirectory);
        }

        sessionRecord.repo = info.repo || sessionRecord.repo;
        sessionRecord.repoFull = info.repoFull || sessionRecord.repoFull;
        sessionRecord.branch = info.branch || sessionRecord.branch;
        sessionRecord.extensionVersion = extensionVersion;
        sessionRecord.sessionStartSource = input.source || null;

        if (input.initialPrompt) {
          captureTaskDescription(sessionRecord, input.initialPrompt, {
            timestamp: eventTimestamp(input),
          });
        }

        if (existing?.type === "session") {
          await persistSessionRecord();
        } else {
          writeRecord(dataDir, sessionRecord);
        }

        recoverOrphans(dataDir).catch((e) =>
          logError(dataDir, "orphan-recovery", e),
        );

        await session.log("📊 Work logger active", { ephemeral: true });
      } catch (err) {
        try { logError(dataDir || ".", "onSessionStart", err); } catch { /* noop */ }
      }
    },

    onUserPromptSubmitted: async (input, invocation) => {
      try {
        if (!sessionRecord || !dataDir) return;

        if (isDelegatedHook(input, invocation)) {
          markCaptureEvent(sessionRecord, "subagent", {
            delegatedSessionId: input.sessionId,
            timestamp: eventTimestamp(input),
          });
          await persistSessionRecord();
          return;
        }

        captureTaskDescription(sessionRecord, input.prompt, {
          timestamp: eventTimestamp(input),
        });

        await persistSessionRecord();

        // Build user preference context (injected BEFORE tool selection)
        const userCtx = buildUserContext(config);

        // "brag" keyword detection (heuristic from lib/heuristics.mjs)
        if (isBragRequest(input.prompt)) {
          const bragContext = [
            "The user wants to save work to their brag sheet.",
            "Summarize what was accomplished and call the `save_to_brag_sheet` tool.",
            "Use impact-first format: 'Did X for Y → Result Z'.",
            `Categories: ${getAllCategoryIds(config).join(", ")}.`,
          ];
          if (userCtx) bragContext.push(userCtx);
          return { additionalContext: bragContext.join(" ") };
        }

        // Surface user preferences on every prompt so the AI
        // frames save_to_brag_sheet calls with the right style
        if (userCtx) {
          return { additionalContext: userCtx };
        }
      } catch (err) {
        logError(dataDir, "onUserPromptSubmitted", err);
      }
    },

    onPostToolUse: async (input, invocation) => {
      try {
        if (!sessionRecord || !dataDir) return;

        const classification = classifyToolUse(input);
        const recognized = classification.filesCreated.length > 0
          || classification.filesEdited.length > 0
          || classification.prsCreated.length > 0
          || classification.significantActions.length > 0;
        const workingDirectory = resolveHookWorkingDirectory(input, sessionRecord.cwd);
        const recordRepo = detectRepoInfo(sessionRecord.cwd);
        const recordRepoRoot = recordRepo.repoRoot || sessionRecord.cwd;

        const failed = input.toolResult?.resultType
          && input.toolResult.resultType !== "success";
        markCaptureEvent(sessionRecord, failed ? "tool-failure" : "tool-success", {
          recognized,
          delegatedSessionId: isDelegatedHook(input, invocation)
            ? input.sessionId
            : null,
          timestamp: eventTimestamp(input),
        });

        sessionRecord.repo = sessionRecord.repo || recordRepo.repo;
        sessionRecord.repoFull = sessionRecord.repoFull || recordRepo.repoFull;
        sessionRecord.branch = sessionRecord.branch || recordRepo.branch;

        // Use one record-relative base so files in delegated repositories stay distinct.
        for (const filePath of classification.filesCreated) {
          addFileToRecord(sessionRecord, "create",
            path.resolve(workingDirectory, filePath), recordRepoRoot);
        }
        for (const filePath of classification.filesEdited) {
          addFileToRecord(sessionRecord, "edit",
            path.resolve(workingDirectory, filePath), recordRepoRoot);
        }

        // PR creation — dedupe by id+repo
        for (const prInfo of classification.prsCreated) {
          const existing = sessionRecord.prsCreated || [];
          if (!existing.some(p => p.id === prInfo.id && p.repo === prInfo.repo)) {
            sessionRecord.prsCreated = [...existing, prInfo];
          }
        }

        // Significant actions — dedupe
        for (const action of classification.significantActions) {
          sessionRecord.significantActions = dedupeArray([
            ...sessionRecord.significantActions, action,
          ]);
        }

        // Incremental save (crash-safe)
        await persistSessionRecord();
      } catch (err) {
        logError(dataDir, "onPostToolUse", err);
      }
    },

    onPostToolUseFailure: async (input, invocation) => {
      try {
        if (!sessionRecord || !dataDir) return;

        markCaptureEvent(sessionRecord, "tool-failure", {
          delegatedSessionId: isDelegatedHook(input, invocation)
            ? input.sessionId
            : null,
          timestamp: eventTimestamp(input),
        });

        await persistSessionRecord();
      } catch (err) {
        logError(dataDir, "onPostToolUseFailure", err);
      }
    },

    onErrorOccurred: async (input, invocation) => {
      try {
        if (!sessionRecord || !dataDir) return;

        markCaptureEvent(sessionRecord, "error", {
          delegatedSessionId: isDelegatedHook(input, invocation)
            ? input.sessionId
            : null,
          timestamp: eventTimestamp(input),
        });

        await persistSessionRecord();
      } catch (err) {
        logError(dataDir, "onErrorOccurred", err);
      }
    },

    onSessionEnd: async (input, invocation) => {
      try {
        if (!sessionRecord || !dataDir) return;

        if (isDelegatedHook(input, invocation)) {
          markCaptureEvent(sessionRecord, "subagent", {
            delegatedSessionId: input.sessionId,
            timestamp: eventTimestamp(input),
          });
          await persistSessionRecord();
          return;
        }

        finalizeSessionRecord(sessionRecord, {
          reason: input.reason,
          finalMessage: input.finalMessage,
          timestamp: eventTimestamp(input),
        });

        await persistSessionRecord();

        return {
          sessionSummary: sessionRecord.summary
            || sessionRecord.taskDescription?.substring(0, 100),
        };
      } catch (err) {
        logError(dataDir, "onSessionEnd", err);
      }
    },
  },

  tools: [
    // ── save_to_brag_sheet ────────────────────────────────────────────────
    {
      name: "save_to_brag_sheet",
      description: [
        "Save a work entry to the user's brag sheet / work impact log.",
        "Also known as: save work entry, log accomplishment, record impact.",
        "Use for significant accomplishments: PRs, bug fixes, design docs, on-call wins.",
        "Format summary as impact-first: 'Did X for Y → Result Z → Evidence'.",
        "Valid categories: pr, bugfix, infrastructure, investigation, collaboration, tooling, oncall, design, documentation.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Impact-first summary of what was accomplished",
          },
          category: {
            type: "string",
            description: "Category of work",
          },
          impact: {
            type: "string",
            description: "Who/what benefited and how (metrics if possible)",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags for filtering",
          },
          repo: {
            type: "string",
            description: "Repository name (auto-detected if omitted)",
          },
          branch: {
            type: "string",
            description: "Branch name (auto-detected if omitted)",
          },
          idempotencyKey: {
            type: "string",
            description:
              "Stable source event or work-item id. Reusing it returns the existing entry.",
          },
        },
        required: ["summary"],
      },
      handler: async (args, invocation) => {
        try {
          ensureInitialized();

          const result = await saveBragEntry({
            ...args,
            repo: args.repo || sessionRecord?.repo || null,
            branch: args.branch || sessionRecord?.branch || null,
            sessionId: sessionRecord?.id || invocation.sessionId || null,
          }, { dataDir, config, gitConfig });

          if (!result.ok) {
            return {
              textResultForLlm: `Error: ${result.message}`,
              resultType: "failure",
            };
          }

          const label = result.entry.category ? ` [${result.entry.category}]` : "";
          const verb = result.deduplicated ? "Already saved" : "Saved";
          await session.log(`📊 ${verb} to brag sheet: ${result.entry.summary}`);
          return `✅ ${verb} to brag sheet${label}: "${result.entry.summary}"`;
        } catch (err) {
          logError(dataDir, "save_to_brag_sheet", err);
          return {
            textResultForLlm: `Error saving entry: ${err.message}`,
            resultType: "failure",
          };
        }
      },
    },

    // ── review_brag_sheet ─────────────────────────────────────────────────
    {
      name: "review_brag_sheet",
      description:
        "Read recent entries from the user's brag sheet / work impact log. "
        + "Also known as: review work log, show recent work, summarize accomplishments. "
        + "Use to review, refine, or summarize work for performance reviews or manager discussions.",
      parameters: {
        type: "object",
        properties: {
          weeks: {
            type: "number",
            description: "Number of recent weeks to show (default: 4)",
          },
        },
      },
      handler: async (args) => {
        try {
          ensureInitialized();

          const result = reviewBragEntries(args, { dataDir, config });
          const markdown = result.markdown || "No entries found for the requested period.";
          const prefix = config?.preset === "microsoft"
            ? "_Formatted for Connect review. Use impact framing: Did X → Result Y → Evidence Z._\n\n"
            : "";
          return `${prefix}${markdown}`;
        } catch (err) {
          logError(dataDir, "review_brag_sheet", err);
          return {
            textResultForLlm: `Error reading entries: ${err.message}`,
            resultType: "failure",
          };
        }
      },
    },

    // ── generate_work_log ─────────────────────────────────────────────────
    {
      name: "generate_work_log",
      description:
        "Generate a complete work log markdown file from all records. Writes to disk.",
      parameters: {
        type: "object",
        properties: {
          outputPath: {
            type: "string",
            description:
              "Output file path (defaults to work-log.md in data directory)",
          },
        },
      },
      handler: async (args) => {
        try {
          ensureInitialized();

          const result = generateWorkLog(args, { dataDir, config, gitConfig });
          return `✅ Work log generated: ${result.outputPath} (${result.recordCount} records)`;
        } catch (err) {
          logError(dataDir, "generate_work_log", err);
          return {
            textResultForLlm: `Error generating work log: ${err.message}`,
            resultType: "failure",
          };
        }
      },
    },
  ],
});

// ── Emergency shutdown save ─────────────────────────────────────────────────
// Synchronous write — process may exit immediately after this handler.
// Only active records need recovery; preserve completed and incomplete records.

function emergencySave(timestamp = new Date()) {
  try {
    if (!sessionRecord || !dataDir) return;
    if (sessionRecord.status !== "active") return;

    finalizeSessionRecord(sessionRecord, {
      reason: "shutdown",
      timestamp,
    });
    sessionRecord.status = "emergency-saved";

    // writeRecord is synchronous — reliable during shutdown
    writeRecord(dataDir, sessionRecord);
  } catch (err) {
    try { logError(dataDir, "emergency-save", err); } catch { /* noop */ }
  }
}

session.on("session.shutdown", (event) => emergencySave(event?.timestamp));
process.once("exit", () => emergencySave());
// Observe transport shutdown without consuming stdin or changing its flow mode.
process.stdin.once("end", () => emergencySave());
process.stdin.once("close", () => emergencySave());
for (const [signal, exitCode] of [["SIGTERM", 143], ["SIGINT", 130]]) {
  process.once(signal, () => {
    emergencySave();
    process.exit(exitCode);
  });
}

session.on("session.compaction_complete", (event) => {
  try {
    if (!sessionRecord || !dataDir) return;
    markCaptureEvent(sessionRecord, "compaction", {
      timestamp: event?.timestamp || new Date(),
    });
    persistSessionRecord()
      .catch((err) => logError(dataDir, "session.compaction_complete", err));
  } catch (err) {
    try { logError(dataDir, "session.compaction_complete", err); } catch { /* noop */ }
  }
});

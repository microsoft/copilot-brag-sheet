/**
 * @fileoverview Copilot Brag Sheet — Copilot CLI Extension
 *
 * Automatically tracks Copilot CLI sessions into structured JSON records
 * and provides tools for maintaining a personal work impact log.
 * Zero dependencies, cross-platform (Windows/macOS/Linux), Node 18+.
 *
 * @license MIT
 * @see https://github.com/vidhartbhatia/copilot-brag-sheet
 */

import { joinSession } from "@github/copilot-sdk/extension";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  existsSync as fileExists,
  openSync, closeSync, writeFileSync, readFileSync as readFile, fsyncSync,
  renameSync, unlinkSync,
} from "node:fs";

import { detectDataDir, detectBragSheetPath, detectGitConfig, ensureDir } from "./lib/paths.mjs";
import { loadConfig, getAllCategoryIds, isValidCategory, buildUserContext } from "./lib/config.mjs";
import {
  writeRecord, readRecords, updateRecord, logError,
} from "./lib/storage.mjs";
import { backupToGit, ensureGitRepo, addRemote } from "./lib/git-backup.mjs";
import {
  createSessionRecord, createEntryRecord,
  addFileToRecord, sanitize, dedupeArray,
} from "./lib/records.mjs";
import { renderMarkdown, renderReviewSummary } from "./lib/render.mjs";

// ── Module-level state (one session per extension process) ──────────────────

let dataDir = null;
let config = null;
let gitConfig = null;
let sessionRecord = null;
let repoRoot = null;
let firstPromptCaptured = false;

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

function atomicWriteText(filePath, text) {
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  let fd;
  try {
    fd = openSync(tmpPath, "w");
    writeFileSync(fd, text, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmpPath, filePath);
  } catch (err) {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* noop */ }
    }
    try { unlinkSync(tmpPath); } catch { /* noop */ }
    throw err;
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

// ── Tool classification ─────────────────────────────────────────────────────

const FILE_CREATE_TOOLS = new Set(["create", "create_file"]);
const FILE_EDIT_TOOLS = new Set(["edit", "edit_file", "str_replace_editor"]);
const PR_TOOLS = new Set([
  "github-create_pull_request",
  "github-create_pull_request_with_copilot",
  "ado-corp-repo_create_pull_request",
]);
const SHELL_TOOLS = new Set(["powershell", "bash"]);

function extractFilePath(toolArgs) {
  return toolArgs?.path || null;
}

function extractPrInfo(toolName, toolArgs, toolResult) {
  if (toolResult?.resultType === "failure") return null;

  const title = toolArgs?.title || null;
  const repo = toolArgs?.repo
    ? (toolArgs.owner ? `${toolArgs.owner}/${toolArgs.repo}` : toolArgs.repo)
    : null;

  // Try structured result fields first
  const resultText = typeof toolResult?.textResultForLlm === "string"
    ? toolResult.textResultForLlm : "";
  const numMatch = resultText.match(/"number":\s*(\d+)/)
    || resultText.match(/pullRequestId["\s:]+(\d+)/i);
  const prId = numMatch ? parseInt(numMatch[1], 10) : null;

  if (title || prId) {
    return { id: prId, title: title || "(untitled)", repo };
  }
  return null;
}

function detectShellGitAction(command) {
  if (!command) return null;
  if (/\bgit\s+commit\b/i.test(command)) return "git commit";
  if (/\bgit\s+push\b/i.test(command)) return "git push";
  return null;
}

// ── Extension entry point ───────────────────────────────────────────────────

const session = await joinSession({
  hooks: {
    onSessionStart: async (input, invocation) => {
      try {
        dataDir = detectDataDir();
        ensureDir(dataDir);
        config = loadConfig(dataDir);
        // Let env vars override config.json for backward compat
        const envGitConfig = detectGitConfig();
        gitConfig = envGitConfig.enabled ? envGitConfig : config.git;
        firstPromptCaptured = false;

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

        const info = detectRepoInfo(input.cwd);
        repoRoot = info.repoRoot;

        sessionRecord = createSessionRecord(invocation.sessionId, input.cwd);
        sessionRecord.repo = info.repo;
        sessionRecord.repoFull = info.repoFull;
        sessionRecord.branch = info.branch;

        writeRecord(dataDir, sessionRecord);

        recoverOrphans(dataDir).catch((e) =>
          logError(dataDir, "orphan-recovery", e),
        );

        await session.log("📊 Work logger active", { ephemeral: true });
      } catch (err) {
        try { logError(dataDir || ".", "onSessionStart", err); } catch { /* noop */ }
      }
    },

    onUserPromptSubmitted: async (input) => {
      try {
        if (!sessionRecord || !dataDir) return;

        // Capture first prompt as task description
        if (!firstPromptCaptured && input.prompt) {
          firstPromptCaptured = true;
          sessionRecord.taskDescription = sanitize(input.prompt);
          await updateRecord(dataDir, sessionRecord.id, {
            taskDescription: sessionRecord.taskDescription,
          });
        }

        // Build user preference context (injected BEFORE tool selection)
        const userCtx = buildUserContext(config);

        // "brag" keyword detection
        if (/\bbrag\b/i.test(input.prompt)) {
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

    onPostToolUse: async (input) => {
      try {
        if (!sessionRecord || !dataDir) return;

        const { toolName, toolArgs, toolResult } = input;
        let changed = false;

        // File operations (local creates and edits)
        if (FILE_CREATE_TOOLS.has(toolName) || FILE_EDIT_TOOLS.has(toolName)) {
          const filePath = extractFilePath(toolArgs);
          if (filePath) {
            addFileToRecord(sessionRecord, toolName, filePath, repoRoot);
            changed = true;
          }
        }

        // PR creation
        if (PR_TOOLS.has(toolName)) {
          const prInfo = extractPrInfo(toolName, toolArgs, toolResult);
          if (prInfo) {
            const existing = sessionRecord.prsCreated || [];
            if (!existing.some(p => p.id === prInfo.id && p.repo === prInfo.repo)) {
              sessionRecord.prsCreated = [...existing, prInfo];
            }
            sessionRecord.significantActions = dedupeArray([
              ...sessionRecord.significantActions, "pr created",
            ]);
            changed = true;
          }
        }

        // Remote file push (tracked as "git push")
        if (toolName === "github-push_files") {
          sessionRecord.significantActions = dedupeArray([
            ...sessionRecord.significantActions, "git push",
          ]);
          changed = true;
        }

        // Shell-based git operations
        if (SHELL_TOOLS.has(toolName)) {
          const action = detectShellGitAction(toolArgs?.command);
          if (action) {
            sessionRecord.significantActions = dedupeArray([
              ...sessionRecord.significantActions, action,
            ]);
            changed = true;
          }
        }

        // Incremental save (crash-safe)
        if (changed) {
          await updateRecord(dataDir, sessionRecord.id, {
            filesEdited: sessionRecord.filesEdited,
            filesCreated: sessionRecord.filesCreated,
            prsCreated: sessionRecord.prsCreated,
            significantActions: sessionRecord.significantActions,
          });
        }
      } catch (err) {
        logError(dataDir, "onPostToolUse", err);
      }
    },

    onSessionEnd: async (input) => {
      try {
        if (!sessionRecord || !dataDir) return;

        sessionRecord.status = "finalized";
        sessionRecord.endTime = new Date().toISOString();

        if (input.finalMessage) {
          sessionRecord.summary = sessionRecord.summary || sanitize(input.finalMessage);
        }

        await updateRecord(dataDir, sessionRecord.id, {
          status: sessionRecord.status,
          endTime: sessionRecord.endTime,
          summary: sessionRecord.summary,
        });

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
        },
        required: ["summary"],
      },
      handler: async (args, invocation) => {
        try {
          ensureInitialized();

          if (!args.summary?.trim()) {
            return {
              textResultForLlm: "Error: summary is required and cannot be empty",
              resultType: "failure",
            };
          }

          if (args.category && !isValidCategory(config, args.category)) {
            const valid = getAllCategoryIds(config).join(", ");
            return {
              textResultForLlm: `Error: invalid category "${args.category}". Valid: ${valid}`,
              resultType: "failure",
            };
          }

          const entry = createEntryRecord({
            summary: args.summary,
            category: args.category || null,
            impact: args.impact || null,
            tags: args.tags || [],
            repo: args.repo || sessionRecord?.repo || null,
            branch: args.branch || sessionRecord?.branch || null,
            sessionId: sessionRecord?.id || invocation.sessionId || null,
          });

          writeRecord(dataDir, entry);

          // Fire-and-forget git backup
          backupToGit({ dataDir, gitConfig }).catch(() => {});

          const label = args.category ? ` [${args.category}]` : "";
          await session.log(`📊 Saved to brag sheet: ${entry.summary}`);
          return `✅ Entry saved to brag sheet${label}: "${entry.summary}"`;
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

          const weeks = args.weeks ?? 4;
          const records = readRecords(dataDir, {
            since: new Date(Date.now() - weeks * 7 * 86400000).toISOString(),
          });
          const markdown = renderReviewSummary(records, {
            weeks,
            config,
          });
          const result = markdown || "No entries found for the requested period.";
          const prefix = config?.preset === "microsoft"
            ? "_Formatted for Connect review. Use impact framing: Did X → Result Y → Evidence Z._\n\n"
            : "";
          return `${prefix}${result}`;
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

          const records = readRecords(dataDir);
          const markdown = renderMarkdown(records, { config });

          const outputPath = args.outputPath || detectBragSheetPath(dataDir);
          ensureDir(path.dirname(outputPath));
          atomicWriteText(outputPath, markdown);

          // Fire-and-forget git backup
          backupToGit({ dataDir, gitConfig }).catch(() => {});

          return `✅ Work log generated: ${outputPath} (${records.length} records)`;
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
// Guard against downgrading "finalized" to "emergency-saved".

session.on("session.shutdown", (event) => {
  try {
    if (!sessionRecord || !dataDir) return;
    if (sessionRecord.status !== "active") return;

    sessionRecord.status = "emergency-saved";
    sessionRecord.endTime = sessionRecord.endTime || new Date().toISOString();

    // writeRecord is synchronous — reliable during shutdown
    writeRecord(dataDir, sessionRecord);
  } catch (err) {
    try { logError(dataDir, "session.shutdown", err); } catch { /* noop */ }
  }
});

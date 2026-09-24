/**
 * @fileoverview Shared tool handler operations.
 *
 * Encapsulates the "validate → create → persist → backup" orchestration
 * used by every entry point (Copilot CLI extension, MCP server, Agency
 * hooks). Each function returns a discriminated result object
 * `{ ok: true, ... }` or `{ ok: false, code, message, ... }` so callers
 * can format the response for their surface without re-implementing
 * the core logic.
 *
 * Dependency-free (no SDK, no Zod). Node 18+.
 *
 * @license MIT
 * @see https://github.com/microsoft/copilot-brag-sheet
 */

import path from "node:path";
import { statSync } from "node:fs";

import { detectBragSheetPath, ensureDir } from "./paths.mjs";
import { getAllCategoryIds, isValidCategory } from "./config.mjs";
import { writeRecordOnce, readRecords, atomicWriteText, logError } from "./storage.mjs";
import { backupToGit } from "./git-backup.mjs";
import { createEntryRecord, sanitize } from "./records.mjs";
import { renderMarkdown, renderReviewSummary } from "./render.mjs";

// ── saveBragEntry ───────────────────────────────────────────────────────────

/**
 * Validate, create, persist, and optionally git-backup a brag entry.
 *
 * @param {{ summary: string, category?: string, impact?: string, tags?: string[], repo?: string, branch?: string, sessionId?: string, idempotencyKey?: string }} args
 * @param {{ dataDir: string, config: object, gitConfig: object }} ctx
 * @returns {Promise<{ ok: true, entry: object, filePath: string, deduplicated: boolean } | { ok: false, code: string, message: string, validCategories?: string[] }>}
 */
export async function saveBragEntry(args, { dataDir, config, gitConfig }) {
  // Validate summary
  if (!args.summary?.trim()) {
    return {
      ok: false,
      code: "empty_summary",
      message: "summary is required and cannot be empty",
    };
  }

  // Validate category
  if (args.category && !isValidCategory(config, args.category)) {
    const validCategories = getAllCategoryIds(config);
    return {
      ok: false,
      code: "invalid_category",
      message: `invalid category "${args.category}". Valid: ${validCategories.join(", ")}`,
      validCategories,
    };
  }

  const idempotencyKey = args.idempotencyKey || (
    args.sessionId
      ? JSON.stringify([
        args.sessionId,
        sanitize(args.summary),
        args.category || null,
        sanitize(args.impact || ""),
        [...(Array.isArray(args.tags) ? args.tags : [])].sort(),
        args.repo || null,
        args.branch || null,
      ])
      : null
  );

  const candidate = createEntryRecord({
    summary: args.summary,
    category: args.category || null,
    impact: args.impact || null,
    tags: Array.isArray(args.tags) ? args.tags : [],
    repo: args.repo || null,
    branch: args.branch || null,
    sessionId: args.sessionId || null,
    idempotencyKey,
  });

  const persisted = await writeRecordOnce(dataDir, candidate);
  const entry = persisted.record;

  if (persisted.created) {
    // Fire-and-forget git backup — never block on network I/O
    backupToGit({ dataDir, gitConfig }).catch((err) =>
      logError(dataDir, "git-backup", err),
    );
  }

  return {
    ok: true,
    entry,
    filePath: persisted.filePath,
    deduplicated: !persisted.created,
  };
}

// ── reviewBragEntries ───────────────────────────────────────────────────────

/**
 * Read and render recent brag entries.
 *
 * Returns the raw records plus a pre-rendered markdown summary. Callers
 * handle pagination, truncation, and structured output as needed for
 * their surface.
 *
 * @param {{ weeks?: number }} args
 * @param {{ dataDir: string, config: object }} ctx
 * @returns {{ ok: true, records: object[], markdown: string, weeks: number }}
 */
export function reviewBragEntries(args, { dataDir, config }) {
  const weeks = args.weeks ?? 4;

  const records = readRecords(dataDir, {
    since: new Date(Date.now() - weeks * 7 * 86400000).toISOString(),
  });

  const markdown = renderReviewSummary(records, { weeks, config });

  return { ok: true, records, markdown: markdown || "", weeks };
}

// ── generateWorkLog ─────────────────────────────────────────────────────────

/**
 * Generate the complete work-log markdown file.
 *
 * @param {{ outputPath?: string }} args
 * @param {{ dataDir: string, config: object, gitConfig: object }} ctx
 * @returns {{ ok: true, outputPath: string, recordCount: number, bytesWritten: number }}
 */
export function generateWorkLog(args, { dataDir, config, gitConfig }) {
  const records = readRecords(dataDir);
  const markdown = renderMarkdown(records, { config });

  const outputPath = args.outputPath || detectBragSheetPath(dataDir);
  ensureDir(path.dirname(outputPath));
  atomicWriteText(outputPath, markdown);

  // Fire-and-forget git backup
  backupToGit({ dataDir, gitConfig }).catch((err) =>
    logError(dataDir, "git-backup", err),
  );

  let bytesWritten = 0;
  try { bytesWritten = statSync(outputPath).size; } catch { /* noop */ }

  return { ok: true, outputPath, recordCount: records.length, bytesWritten };
}

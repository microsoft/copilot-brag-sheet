/**
 * @fileoverview Copilot Brag Sheet — MCP Server (cross-engine)
 *
 * Stdio MCP server built on the official MCP TypeScript SDK
 * (`@modelcontextprotocol/sdk`) with Zod-validated `inputSchema` /
 * `outputSchema` and MCP tool annotations.
 *
 * Exposes the same three tools as the Copilot CLI extension —
 * `save_to_brag_sheet`, `review_brag_sheet`, and `generate_work_log` — to
 * any MCP host over stdio.
 *
 * Design notes:
 *   - The SDK owns JSON-RPC framing, dispatch, validation, and capability
 *     negotiation. This module only registers tools and delegates to the
 *     existing `lib/*` modules.
 *   - Every tool declares an `outputSchema`; every tool returns
 *     `structuredContent` whose shape matches that schema, plus a text
 *     payload formatted per the requested `response_format`.
 *   - Tool annotations advertise behaviour (read-only / destructive /
 *     idempotent / open-world) so MCP hosts can render confirmation UI.
 *   - Stdout is reserved for JSON-RPC frames (the SDK's StdioServerTransport
 *     handles that). Logs go to stderr.
 *
 * @license MIT
 * @see https://github.com/microsoft/copilot-brag-sheet
 * @see https://modelcontextprotocol.io/specification
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { detectDataDir, detectGitConfig, ensureDir } from "./lib/paths.mjs";
import { loadConfig } from "./lib/config.mjs";
import { logError } from "./lib/storage.mjs";
import { renderReviewSummary } from "./lib/render.mjs";
import {
  saveBragEntry, reviewBragEntries, generateWorkLog,
} from "./lib/operations.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Server name follows the Node MCP convention `{service}-mcp-server`
// documented in the MCP best-practices reference.
const SERVER_NAME = "brag-sheet-mcp-server";

// Cap rendered markdown in the response. Hosts forward tool output into LLM
// context and a runaway brag sheet would burn through it.
const CHARACTER_LIMIT = 25000;

// Default page size for `review_brag_sheet`. Aligned with the 20–50 range
// recommended in the MCP best-practices reference.
const DEFAULT_REVIEW_LIMIT = 20;
const MAX_REVIEW_LIMIT = 100;

let SERVER_VERSION = "unknown";
try {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
  SERVER_VERSION = pkg.version || "unknown";
} catch { /* best effort */ }

// ── Lazy state ──────────────────────────────────────────────────────────────
// Initialised on first tool call so the initialize handshake is fast and so
// detection errors surface in the model's view of the tool result rather
// than as opaque transport errors at startup.

let dataDir = null;
let config = null;
let gitConfig = null;

function ensureInitialized() {
  if (!dataDir) {
    dataDir = detectDataDir();
    ensureDir(dataDir);
  }
  if (!config) {
    config = loadConfig(dataDir);
  }
  if (!gitConfig) {
    const envGit = detectGitConfig();
    gitConfig = envGit.enabled ? envGit : (config?.git ?? { enabled: false, push: false });
  }
}

// atomicWriteText is now in lib/storage.mjs

function truncateMarkdown(markdown) {
  if (typeof markdown !== "string" || markdown.length <= CHARACTER_LIMIT) {
    return { markdown, truncated: false };
  }
  const slice = markdown.slice(0, CHARACTER_LIMIT);
  const note = `\n\n_…truncated to ${CHARACTER_LIMIT} chars. Narrow the window with the \`weeks\` parameter or use \`limit\`/\`offset\` to page._`;
  return { markdown: slice + note, truncated: true };
}

function toolText(text, structuredContent) {
  const result = { content: [{ type: "text", text }] };
  if (structuredContent !== undefined) {
    result.structuredContent = structuredContent;
  }
  return result;
}

function toolError(message, structuredContent) {
  const result = {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
  if (structuredContent !== undefined) {
    result.structuredContent = structuredContent;
  }
  return result;
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const ResponseFormatSchema = z.enum(["markdown", "json"])
  .default("markdown")
  .describe("Output format. 'markdown' is human-readable; 'json' is the raw structured envelope.");

const SaveInputSchema = z.object({
  summary: z.string()
    .min(1, "summary is required and cannot be empty")
    .max(500, "summary must not exceed 500 characters")
    .describe("Impact-first summary of what was accomplished. Format: 'Did X for Y → Result Z → Evidence'."),
  category: z.string()
    .optional()
    .describe("Category id, e.g. 'pr', 'bugfix', 'infrastructure', 'investigation', 'collaboration', 'tooling', 'oncall', 'design', 'documentation'."),
  impact: z.string()
    .optional()
    .describe("Who or what benefited and how. Include metrics if possible (e.g. 'cut latency 40%', '8 partner teams unblocked')."),
  tags: z.array(z.string())
    .optional()
    .describe("Free-form tags for filtering later (e.g. ['mcp','migration'])."),
  repo: z.string()
    .optional()
    .describe("Repository name. Auto-detected from git context when omitted."),
  branch: z.string()
    .optional()
    .describe("Git branch name. Auto-detected from git context when omitted."),
  response_format: ResponseFormatSchema,
}).strict();

const SaveOutputSchema = z.object({
  success: z.boolean().describe("Whether the entry was persisted to disk."),
  entryId: z.string().describe("UUID of the saved entry."),
  category: z.string().nullable().describe("Resolved category id, or null when none was provided."),
  summary: z.string().describe("Sanitized summary actually persisted (newlines stripped, capped to 500 chars)."),
  timestamp: z.string().describe("ISO-8601 timestamp the entry was created at."),
});

const ReviewInputSchema = z.object({
  weeks: z.number()
    .int("weeks must be a whole number")
    .min(1, "weeks must be at least 1")
    .max(104, "weeks must not exceed 104 (2 years)")
    .default(4)
    .describe("Lookback window in weeks. Entries older than now() - weeks*7d are excluded."),
  limit: z.number()
    .int()
    .min(1)
    .max(MAX_REVIEW_LIMIT)
    .default(DEFAULT_REVIEW_LIMIT)
    .describe(`Maximum number of records to return in this page (1–${MAX_REVIEW_LIMIT}, default ${DEFAULT_REVIEW_LIMIT}).`),
  offset: z.number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of records to skip for pagination (default 0)."),
  response_format: ResponseFormatSchema,
}).strict();

const ReviewItemSchema = z.object({
  id: z.string().describe("Record UUID."),
  type: z.string().describe("Record kind, e.g. 'entry' or 'session'."),
  timestamp: z.string().describe("ISO-8601 timestamp of the record."),
  summary: z.string().nullable().describe("Summary text, or null for sessions without one."),
  category: z.string().nullable().describe("Category id, or null."),
  tags: z.array(z.string()).describe("Record tags."),
  impact: z.string().nullable().describe("Impact line, or null."),
  repo: z.string().nullable().describe("Repository name, or null."),
  branch: z.string().nullable().describe("Branch name, or null."),
});

const ReviewOutputSchema = z.object({
  total: z.number().describe("Total records inside the lookback window, before pagination."),
  count: z.number().describe("Number of records in this page."),
  offset: z.number().describe("Pagination offset that was applied."),
  hasMore: z.boolean().describe("True when more records are available beyond this page."),
  nextOffset: z.number().nullable().describe("Offset to request next, or null when there is no further page."),
  weeksCovered: z.number().describe("The lookback window size that was applied, in weeks."),
  items: z.array(ReviewItemSchema).describe("The records in this page, newest first."),
});

const GenerateInputSchema = z.object({
  outputPath: z.string()
    .refine((p) => path.isAbsolute(p), {
      message: "outputPath must be an absolute path (got a relative path)",
    })
    .optional()
    .describe(
      "Absolute path of the markdown file to write. Must be absolute — relative paths are rejected to prevent accidentally clobbering files in the host's working directory. Defaults to work-log.md inside the data directory.",
    ),
  response_format: ResponseFormatSchema,
}).strict();

const GenerateOutputSchema = z.object({
  success: z.boolean().describe("Whether the file was written successfully."),
  outputPath: z.string().describe("Absolute path of the file that was written."),
  recordCount: z.number().describe("Number of records included in the generated work log."),
  bytesWritten: z.number().describe("Size of the written file in bytes."),
});

// ── Render helpers ──────────────────────────────────────────────────────────

function recordToItem(record) {
  return {
    id: record.id,
    type: record.type ?? "entry",
    timestamp: record.timestamp,
    summary: record.summary ?? null,
    category: record.category ?? null,
    tags: Array.isArray(record.tags) ? record.tags : [],
    impact: record.impact ?? null,
    repo: record.repo ?? null,
    branch: record.branch ?? null,
  };
}

function renderSavedMarkdown(entry) {
  const label = entry.category ? ` [${entry.category}]` : "";
  return `✅ Entry saved to brag sheet${label}: "${entry.summary}"`;
}

function renderReviewMarkdown({ records, weeks, total, offset, hasMore }) {
  const rendered = renderReviewSummary(records, { weeks, config });
  const body = rendered || "No entries found for the requested period.";
  const prefix = config?.preset === "microsoft"
    ? "_Formatted for Connect review. Use impact framing: Did X → Result Y → Evidence Z._\n\n"
    : "";
  const pageNote = `\n\n_Showing ${records.length} of ${total} record(s) in the last ${weeks} week(s) (offset=${offset}${hasMore ? `, more available — request offset=${offset + records.length}` : ""})._`;
  const fullText = `${prefix}${body}${pageNote}`;
  return truncateMarkdown(fullText);
}

// ── Tool handlers ───────────────────────────────────────────────────────────

async function handleSaveToBragSheet(args) {
  ensureInitialized();

  const result = saveBragEntry({
    summary: args.summary,
    category: args.category || null,
    impact: args.impact || null,
    tags: Array.isArray(args.tags) ? args.tags : [],
    repo: args.repo || null,
    branch: args.branch || null,
    sessionId: null,
  }, { dataDir, config, gitConfig });

  if (!result.ok) {
    return toolError(
      result.message,
      {
        success: false,
        entryId: "",
        category: args.category || null,
        summary: args.summary,
        timestamp: new Date().toISOString(),
      },
    );
  }

  const structuredContent = {
    success: true,
    entryId: result.entry.id,
    category: result.entry.category,
    summary: result.entry.summary,
    timestamp: result.entry.timestamp,
  };

  const text = args.response_format === "json"
    ? JSON.stringify(structuredContent, null, 2)
    : renderSavedMarkdown(result.entry);

  return toolText(text, structuredContent);
}

async function handleReviewBragSheet(args) {
  ensureInitialized();

  const weeks = args.weeks ?? 4;
  const limit = args.limit ?? DEFAULT_REVIEW_LIMIT;
  const offset = args.offset ?? 0;

  const result = reviewBragEntries({ weeks }, { dataDir, config });

  // MCP-specific: sort newest-first, apply pagination
  const allRecords = result.records;
  allRecords.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));

  const total = allRecords.length;
  const page = allRecords.slice(offset, offset + limit);
  const hasMore = offset + page.length < total;
  const nextOffset = hasMore ? offset + page.length : null;

  const structuredContent = {
    total,
    count: page.length,
    offset,
    hasMore,
    nextOffset,
    weeksCovered: weeks,
    items: page.map(recordToItem),
  };

  let text;
  if (args.response_format === "json") {
    text = JSON.stringify(structuredContent, null, 2);
  } else {
    const { markdown } = renderReviewMarkdown({
      records: page,
      weeks,
      total,
      offset,
      hasMore,
    });
    text = markdown;
  }

  return toolText(text, structuredContent);
}

async function handleGenerateWorkLog(args) {
  ensureInitialized();

  const result = generateWorkLog(args, { dataDir, config, gitConfig });

  const structuredContent = {
    success: true,
    outputPath: result.outputPath,
    recordCount: result.recordCount,
    bytesWritten: result.bytesWritten,
  };

  const text = args.response_format === "json"
    ? JSON.stringify(structuredContent, null, 2)
    : `✅ Work log generated: ${result.outputPath} (${result.recordCount} records, ${result.bytesWritten} bytes)`;

  return toolText(text, structuredContent);
}

// Wrap a handler so any thrown error becomes a model-visible isError result
// instead of a transport-level error. The SDK already does Zod input
// validation; this catches lib/* failures (disk full, permission denied, …).
//
// Tool calls share a single FIFO queue so a batch like
// [save_to_brag_sheet, generate_work_log] processes deterministically — the
// SDK dispatches messages concurrently otherwise.
let toolQueue = Promise.resolve();

function safe(name, handler) {
  return (args) => {
    const next = toolQueue.then(async () => {
      try {
        return await handler(args);
      } catch (err) {
        try { logError(dataDir || ".", `tools/call:${name}`, err); } catch { /* noop */ }
        return toolError(err?.message || String(err));
      }
    });
    toolQueue = next.then(() => undefined, () => undefined);
    return next;
  };
}

// ── Server registration ─────────────────────────────────────────────────────

export function buildServer() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "save_to_brag_sheet",
    {
      title: "Save brag sheet entry",
      description: [
        "Save a work entry to the user's brag sheet / work impact log.",
        "Also known as: save work entry, log accomplishment, record impact.",
        "Use for significant accomplishments: PRs, bug fixes, design docs, on-call wins.",
        "Format the `summary` as impact-first: 'Did X for Y → Result Z → Evidence'.",
        "Valid categories: pr, bugfix, infrastructure, investigation, collaboration, tooling, oncall, design, documentation.",
        "Returns the saved entry id, category, sanitized summary, and timestamp in `structuredContent`.",
        "Honors `response_format` ('markdown' for a confirmation line, 'json' for the raw envelope).",
      ].join(" "),
      inputSchema: SaveInputSchema,
      outputSchema: SaveOutputSchema,
      annotations: {
        title: "Save brag sheet entry",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    safe("save_to_brag_sheet", handleSaveToBragSheet),
  );

  server.registerTool(
    "review_brag_sheet",
    {
      title: "Review recent brag sheet entries",
      description: [
        "Read recent entries from the user's brag sheet / work impact log, paginated.",
        "Also known as: review work log, show recent work, summarize accomplishments.",
        "Use to review, refine, or summarize work for performance reviews or manager discussions.",
        `Pagination: \`limit\` (1–${MAX_REVIEW_LIMIT}, default ${DEFAULT_REVIEW_LIMIT}), \`offset\` (default 0).`,
        "`structuredContent` returns { total, count, offset, hasMore, nextOffset, weeksCovered, items }.",
        "Honors `response_format` ('markdown' for a rendered report, 'json' for the raw envelope).",
      ].join(" "),
      inputSchema: ReviewInputSchema,
      outputSchema: ReviewOutputSchema,
      annotations: {
        title: "Review recent brag sheet entries",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safe("review_brag_sheet", handleReviewBragSheet),
  );

  server.registerTool(
    "generate_work_log",
    {
      title: "Generate work log file",
      description: [
        "Generate a complete work log markdown file from all records and write it to disk.",
        "Overwrites the output file atomically.",
        "Defaults to <dataDir>/work-log.md when `outputPath` is omitted.",
        "Returns success, absolute output path, record count, and bytes written in `structuredContent`.",
        "Honors `response_format` ('markdown' for a confirmation line, 'json' for the raw envelope).",
      ].join(" "),
      inputSchema: GenerateInputSchema,
      outputSchema: GenerateOutputSchema,
      annotations: {
        title: "Generate work log file",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    safe("generate_work_log", handleGenerateWorkLog),
  );

  return server;
}

// ── Entry point ─────────────────────────────────────────────────────────────

export async function runServer({ stdin = process.stdin, stdout = process.stdout } = {}) {
  const server = buildServer();
  const transport = new StdioServerTransport(stdin, stdout);
  await server.connect(transport);

  // The SDK keeps the event loop alive via stdin's data listener. When the
  // peer closes stdin we let any in-flight tool calls drain (via toolQueue)
  // before resolving so responses make it onto the wire before exit.
  await new Promise((resolve) => {
    const finish = async () => {
      try { await toolQueue; } catch { /* swallowed inside safe() */ }
      // One more microtask hop so the SDK's transport.send() promises settle.
      await new Promise((r) => setImmediate(r));
      resolve();
    };
    stdin.once?.("end", finish);
    stdin.once?.("close", finish);
  });
}

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  runServer().catch((err) => {
    process.stderr.write(`[brag-sheet mcp] fatal: ${err?.stack || err}\n`);
    process.exit(1);
  });
}

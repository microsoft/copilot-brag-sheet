/**
 * @fileoverview Copilot Brag Sheet — MCP Server (cross-engine)
 *
 * Hand-rolled stdio JSON-RPC 2.0 server implementing the Model Context
 * Protocol (MCP). Exposes the same three tools as the Copilot CLI extension
 * (save_to_brag_sheet, review_brag_sheet, generate_work_log) so any
 * MCP-compatible host (Claude Code, Codex CLI, VS Code, Agency, Cursor) can
 * use the brag sheet without the Copilot-specific joinSession() API.
 *
 * Protocol references:
 *   - MCP spec:   https://modelcontextprotocol.io/specification/2025-06-18
 *   - JSON-RPC 2: https://www.jsonrpc.org/specification
 *
 * Design notes:
 *   - Zero runtime dependencies (preserves the package's brand promise).
 *   - extension.mjs is left untouched; this module is purely additive.
 *   - All real work is delegated to the existing lib/* modules — this file
 *     is just a transport/protocol shim.
 *   - All logs go to stderr; stdout is reserved for JSON-RPC frames.
 *
 * @license MIT
 * @see https://github.com/microsoft/copilot-brag-sheet
 */

import path from "node:path";
import {
  openSync, closeSync, writeFileSync, fsyncSync,
  renameSync, unlinkSync,
} from "node:fs";

import { detectDataDir, detectBragSheetPath, detectGitConfig, ensureDir } from "./lib/paths.mjs";
import { loadConfig, getAllCategoryIds, isValidCategory } from "./lib/config.mjs";
import { writeRecord, readRecords, logError } from "./lib/storage.mjs";
import { backupToGit } from "./lib/git-backup.mjs";
import { createEntryRecord } from "./lib/records.mjs";
import { renderMarkdown, renderReviewSummary } from "./lib/render.mjs";

// Read package.json once at startup for the server version reported in
// the initialize handshake. Best-effort — fall back to "unknown".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let SERVER_VERSION = "unknown";
try {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
  SERVER_VERSION = pkg.version || "unknown";
} catch { /* best effort */ }

const SERVER_NAME = "copilot-brag-sheet";
const PROTOCOL_VERSION = "2025-06-18";

// ── Lazy state ──────────────────────────────────────────────────────────────
// Initialised on first tool call so the initialize handshake is fast and so
// errors surface in tool responses (where the host can show them) rather
// than at module load time.

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

// ── Tool definitions ────────────────────────────────────────────────────────
// Schemas and descriptions kept in sync with extension.mjs so any host gets
// the same tool surface regardless of how the package is loaded.

const TOOLS = [
  {
    name: "save_to_brag_sheet",
    description: [
      "Save a work entry to the user's brag sheet / work impact log.",
      "Also known as: save work entry, log accomplishment, record impact.",
      "Use for significant accomplishments: PRs, bug fixes, design docs, on-call wins.",
      "Format summary as impact-first: 'Did X for Y → Result Z → Evidence'.",
      "Valid categories: pr, bugfix, infrastructure, investigation, collaboration, tooling, oncall, design, documentation.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Impact-first summary of what was accomplished" },
        category: { type: "string", description: "Category of work" },
        impact: { type: "string", description: "Who/what benefited and how (metrics if possible)" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for filtering" },
        repo: { type: "string", description: "Repository name (auto-detected if omitted)" },
        branch: { type: "string", description: "Branch name (auto-detected if omitted)" },
      },
      required: ["summary"],
    },
  },
  {
    name: "review_brag_sheet",
    description:
      "Read recent entries from the user's brag sheet / work impact log. "
      + "Also known as: review work log, show recent work, summarize accomplishments. "
      + "Use to review, refine, or summarize work for performance reviews or manager discussions.",
    inputSchema: {
      type: "object",
      properties: {
        weeks: { type: "number", description: "Number of recent weeks to show (default: 4)" },
      },
    },
  },
  {
    name: "generate_work_log",
    description: "Generate a complete work log markdown file from all records. Writes to disk.",
    inputSchema: {
      type: "object",
      properties: {
        outputPath: {
          type: "string",
          description: "Output file path (defaults to work-log.md in data directory)",
        },
      },
    },
  },
];

// ── Tool handlers ───────────────────────────────────────────────────────────
// Each handler returns an MCP tool result: { content: [{type:"text",text}], isError? }

async function handleSaveToBragSheet(args) {
  ensureInitialized();

  if (!args?.summary || !String(args.summary).trim()) {
    return toolError("summary is required and cannot be empty");
  }

  if (args.category && !isValidCategory(config, args.category)) {
    const valid = getAllCategoryIds(config).join(", ");
    return toolError(`invalid category "${args.category}". Valid: ${valid}`);
  }

  const entry = createEntryRecord({
    summary: args.summary,
    category: args.category || null,
    impact: args.impact || null,
    tags: Array.isArray(args.tags) ? args.tags : [],
    repo: args.repo || null,
    branch: args.branch || null,
    sessionId: null, // MCP servers have no Copilot session context
  });

  writeRecord(dataDir, entry);

  // Fire-and-forget git backup — never block tool response on network I/O.
  backupToGit({ dataDir, gitConfig }).catch(() => {});

  const label = args.category ? ` [${args.category}]` : "";
  return toolText(`✅ Entry saved to brag sheet${label}: "${entry.summary}"`);
}

async function handleReviewBragSheet(args) {
  ensureInitialized();

  const weeks = args?.weeks ?? 4;
  const records = readRecords(dataDir, {
    since: new Date(Date.now() - weeks * 7 * 86400000).toISOString(),
  });
  const markdown = renderReviewSummary(records, { weeks, config });
  const result = markdown || "No entries found for the requested period.";
  const prefix = config?.preset === "microsoft"
    ? "_Formatted for Connect review. Use impact framing: Did X → Result Y → Evidence Z._\n\n"
    : "";
  return toolText(`${prefix}${result}`);
}

async function handleGenerateWorkLog(args) {
  ensureInitialized();

  const records = readRecords(dataDir);
  const markdown = renderMarkdown(records, { config });

  const outputPath = args?.outputPath || detectBragSheetPath(dataDir);
  ensureDir(path.dirname(outputPath));
  atomicWriteText(outputPath, markdown);

  // Fire-and-forget git backup.
  backupToGit({ dataDir, gitConfig }).catch(() => {});

  return toolText(`✅ Work log generated: ${outputPath} (${records.length} records)`);
}

const HANDLERS = {
  save_to_brag_sheet: handleSaveToBragSheet,
  review_brag_sheet: handleReviewBragSheet,
  generate_work_log: handleGenerateWorkLog,
};

function toolText(text) {
  return { content: [{ type: "text", text }] };
}

function toolError(message) {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

// ── JSON-RPC dispatcher ─────────────────────────────────────────────────────

async function dispatch(message) {
  const { id, method, params } = message;

  // Notifications (no `id`) — process side effects, return nothing.
  if (id === undefined || id === null) {
    // We don't act on any notification today; "notifications/initialized" is
    // accepted silently so hosts that send it don't see errors.
    return null;
  }

  switch (method) {
    case "initialize": {
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    }
    case "tools/list": {
      return rpcResult(id, { tools: TOOLS });
    }
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments || {};
      const handler = HANDLERS[name];
      if (!handler) {
        return rpcError(id, -32602, `Unknown tool: ${name}`);
      }
      try {
        const result = await handler(args);
        return rpcResult(id, result);
      } catch (err) {
        try { logError(dataDir || ".", `tools/call:${name}`, err); } catch { /* noop */ }
        // MCP convention: report tool execution failures as a normal result
        // with isError=true rather than a JSON-RPC error, so the model can
        // see and reason about the failure.
        return rpcResult(id, toolError(err?.message || String(err)));
      }
    }
    case "ping": {
      return rpcResult(id, {});
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

// ── Stdio framing ───────────────────────────────────────────────────────────
// MCP stdio transport uses newline-delimited JSON (one JSON-RPC message per
// line). We buffer partial lines because Node may deliver chunked stdin.

export async function runServer({ stdin = process.stdin, stdout = process.stdout } = {}) {
  stdin.setEncoding("utf8");

  let buffer = "";

  const writeFrame = (msg) => {
    if (!msg) return;
    stdout.write(`${JSON.stringify(msg)}\n`);
  };

  const handleLine = async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      writeFrame(rpcError(null, -32700, "Parse error"));
      return;
    }

    if (!message || message.jsonrpc !== "2.0") {
      writeFrame(rpcError(message?.id ?? null, -32600, "Invalid Request"));
      return;
    }

    try {
      const response = await dispatch(message);
      writeFrame(response);
    } catch (err) {
      writeFrame(rpcError(message.id ?? null, -32603, err?.message || "Internal error"));
    }
  };

  return new Promise((resolve) => {
    stdin.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      // Process every complete line currently in the buffer.
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        handleLine(line);
      }
    });
    stdin.on("end", () => {
      // Flush any trailing line without a newline.
      if (buffer.trim()) {
        handleLine(buffer);
        buffer = "";
      }
      resolve();
    });
    stdin.on("error", (err) => {
      try { logError(dataDir || ".", "stdin", err); } catch { /* noop */ }
      resolve();
    });
  });
}

// Auto-start when invoked as the main module (so `node mcp-server.mjs` and
// `bin/mcp-server.mjs` both Just Work). Tests can import { runServer } and
// drive it with their own streams.
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  runServer().catch((err) => {
    process.stderr.write(`[brag-sheet mcp] fatal: ${err?.stack || err}\n`);
    process.exit(1);
  });
}

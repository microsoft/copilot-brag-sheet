#!/usr/bin/env node

/**
 * @fileoverview Agency PostToolUse hook — classify tool calls for the brag sheet.
 *
 * Reads a JSON hook payload from stdin, classifies the tool call via
 * lib/heuristics.mjs, and writes a JSON response to stdout. Designed
 * for the Agency hook protocol (stdin JSON → stdout JSON).
 *
 * IMPORTANT: No console.log — stdout is the hook response channel.
 * Debug output goes to stderr, gated on BRAG_SHEET_DEBUG=1.
 *
 * @license MIT
 * @see https://github.com/microsoft/copilot-brag-sheet
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.join(__dirname, "..");

// Lazy imports to minimize cold-start time
let classifyToolUse;

async function ensureImports() {
  if (classifyToolUse) return;
  const heuristicsUrl = pathToFileURL(path.join(libDir, "lib", "heuristics.mjs")).href;
  const heuristics = await import(heuristicsUrl);
  classifyToolUse = heuristics.classifyToolUse;
}

function debug(msg) {
  if (process.env.BRAG_SHEET_DEBUG) {
    process.stderr.write(`[brag-sheet hook] ${msg}\n`);
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  try {
    const raw = await readStdin();
    const payload = JSON.parse(raw);

    debug(`PostToolUse: ${payload.tool_name || payload.toolName || "unknown"}`);

    await ensureImports();

    // Agency hook payload may use snake_case or camelCase
    const toolName = payload.tool_name || payload.toolName || "";
    const toolArgs = payload.tool_input || payload.toolArgs || {};
    const toolResult = payload.tool_result || payload.toolResult || {};

    const classification = classifyToolUse({ toolName, toolArgs, toolResult });

    const hasActivity =
      classification.filesCreated.length > 0 ||
      classification.filesEdited.length > 0 ||
      classification.prsCreated.length > 0 ||
      classification.significantActions.length > 0;

    if (hasActivity) {
      debug(`Classified: ${JSON.stringify(classification)}`);
    }

    // Respond with the hook result
    const response = {
      continue: true,
      classification: hasActivity ? classification : undefined,
    };

    process.stdout.write(JSON.stringify(response));
  } catch (err) {
    debug(`Error: ${err.message}`);
    // Always return valid JSON — never crash the hook chain
    process.stdout.write(JSON.stringify({ continue: true }));
  }
}

main();

/**
 * @fileoverview Tool classification and event detection heuristics.
 *
 * Pure functions for classifying Copilot tool calls into semantic events
 * (file edits, PR creation, git actions) and detecting user intent signals
 * (brag keyword). Extracted from extension.mjs so any entry point —
 * Copilot CLI extension, MCP server, Agency hooks — can reuse the same
 * classification logic without duplication.
 *
 * Dependency-free (no SDK, no Zod). Node 18+.
 *
 * @license MIT
 * @see https://github.com/microsoft/copilot-brag-sheet
 */

// ── Tool classification sets ────────────────────────────────────────────────

export const FILE_CREATE_TOOLS = new Set(["create", "create_file"]);
export const FILE_EDIT_TOOLS = new Set(["edit", "edit_file", "str_replace_editor"]);
export const PR_TOOLS = new Set([
  "github-create_pull_request",
  "github-create_pull_request_with_copilot",
  "ado-corp-repo_create_pull_request",
]);
export const SHELL_TOOLS = new Set(["powershell", "bash"]);

// ── Extraction helpers ──────────────────────────────────────────────────────

export function extractFilePath(toolArgs) {
  return toolArgs?.path || null;
}

export function extractPrInfo(toolName, toolArgs, toolResult) {
  if (toolResult?.resultType === "failure") return null;

  const title = toolArgs?.title || null;
  const repo = toolArgs?.repo
    ? (toolArgs.owner ? `${toolArgs.owner}/${toolArgs.repo}` : toolArgs.repo)
    : null;

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

export function detectShellGitAction(command) {
  if (!command) return null;
  if (/\bgit\s+commit\b/i.test(command)) return "git commit";
  if (/\bgit\s+push\b/i.test(command)) return "git push";
  return null;
}

// ── Brag keyword detection ──────────────────────────────────────────────────

const BRAG_REGEX = /\bbrag\b/i;

/**
 * Detect whether the user is asking to save work to their brag sheet.
 *
 * The `\b` word boundary already prevents matching "bragging" or
 * "braggart" — no exclusion regex needed.
 *
 * @param {string|null|undefined} prompt
 * @returns {boolean}
 */
export function isBragRequest(prompt) {
  if (!prompt) return false;
  return BRAG_REGEX.test(prompt);
}

// ── Composite classifier ────────────────────────────────────────────────────

/**
 * Classify a single tool call into semantic events.
 *
 * Returns a pure data object describing what happened — no mutation,
 * no side effects. The caller decides how to apply the result to its
 * own state (session record, hook output, etc.).
 *
 * @param {{ toolName: string, toolArgs: object|null, toolResult: object }} input
 * @returns {{ filesCreated: string[], filesEdited: string[], prsCreated: object[], significantActions: string[] }}
 */
export function classifyToolUse({ toolName, toolArgs, toolResult }) {
  const filesCreated = [];
  const filesEdited = [];
  const prsCreated = [];
  const significantActions = [];

  // File operations
  if (FILE_CREATE_TOOLS.has(toolName)) {
    const filePath = extractFilePath(toolArgs);
    if (filePath) filesCreated.push(filePath);
  } else if (FILE_EDIT_TOOLS.has(toolName)) {
    const filePath = extractFilePath(toolArgs);
    if (filePath) filesEdited.push(filePath);
  }

  // PR creation
  if (PR_TOOLS.has(toolName)) {
    const prInfo = extractPrInfo(toolName, toolArgs, toolResult);
    if (prInfo) {
      prsCreated.push(prInfo);
      significantActions.push("pr created");
    }
  }

  // Remote file push
  if (toolName === "github-push_files") {
    significantActions.push("git push");
  }

  // Shell-based git operations
  if (SHELL_TOOLS.has(toolName)) {
    const action = detectShellGitAction(toolArgs?.command);
    if (action) significantActions.push(action);
  }

  return { filesCreated, filesEdited, prsCreated, significantActions };
}

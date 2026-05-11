#!/usr/bin/env node
/**
 * Shebang entry point so the MCP server can be launched by name via npm
 * `bin` registration. All behaviour lives in ../mcp-server.mjs.
 *
 * Invoke from a published package via `npm exec`:
 *   npx -y --package copilot-brag-sheet copilot-brag-sheet-mcp
 *
 * Wire into Claude Code:
 *   claude mcp add brag-sheet -- npx -y --package copilot-brag-sheet copilot-brag-sheet-mcp
 *
 * (Plain `npx copilot-brag-sheet-mcp` does NOT work — `copilot-brag-sheet-mcp`
 * is a bin entry inside the `copilot-brag-sheet` package, not its own
 * package on the registry, so `npx` cannot resolve the name on its own.)
 */
import { runServer } from "../mcp-server.mjs";

runServer().catch((err) => {
  process.stderr.write(`[brag-sheet mcp] fatal: ${err?.stack || err}\n`);
  process.exit(1);
});


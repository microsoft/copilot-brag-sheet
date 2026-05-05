#!/usr/bin/env node
/**
 * Shebang entry point so the MCP server can be launched by name via npm
 * `bin` registration. All behaviour lives in ../mcp-server.mjs.
 *
 *   npx copilot-brag-sheet-mcp
 *   claude mcp add --transport stdio brag-sheet -- npx copilot-brag-sheet-mcp
 */
import { runServer } from "../mcp-server.mjs";

runServer().catch((err) => {
  process.stderr.write(`[brag-sheet mcp] fatal: ${err?.stack || err}\n`);
  process.exit(1);
});


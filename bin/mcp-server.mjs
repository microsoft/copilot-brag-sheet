#!/usr/bin/env node
/**
 * Thin shebang wrapper so the MCP server can be launched by name via npm
 * `bin` registration. All behaviour lives in ../mcp-server.mjs.
 *
 *   npx copilot-brag-sheet-mcp
 *   claude mcp add --transport stdio brag-sheet -- npx copilot-brag-sheet-mcp
 */
import "../mcp-server.mjs";

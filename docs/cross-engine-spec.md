# Cross-Engine Support: MCP Server + Hooks

> **Issue:** microsoft/copilot-brag-sheet#22  
> **Status:** Research complete, spec draft, pending full review  
> **Priority:** Post-FHL (after May 1)  
> **Scope:** Full (tools + hooks — full extension parity)  
> **Distribution:** Agency first (internal MSFT), then public Claude Code plugin

---

## Problem

copilot-brag-sheet only works with Copilot CLI via `extension.mjs` + `joinSession()`. Microsoft engineers using Agency (which supports both Copilot CLI and Claude Code) can't get the auto-tracking functionality. The `joinSession()` API is Copilot-specific and has no equivalent in Claude Code.

## Solution

Replace the Copilot-specific tool registration with an **MCP server** (universal) and **hooks.json** (cross-engine via Agency). The existing `extension.mjs` continues to work for standalone Copilot CLI users.

## Architecture

```
microsoft/copilot-brag-sheet/
├── lib/                         # Shared core (UNCHANGED — zero deps, pure Node.js)
│   ├── paths.mjs                #   Data dir detection
│   ├── config.mjs               #   Presets, categories
│   ├── storage.mjs              #   JSON record I/O
│   ├── records.mjs              #   Record creation, sanitization
│   ├── render.mjs               #   Markdown generation
│   └── git-backup.mjs           #   Auto-push to private repo
│
├── extension.mjs                # Copilot CLI adapter (EXISTING — joinSession API)
│
├── mcp-server.mjs               # NEW: MCP stdio server (3 tools)
├── hooks/                       # NEW: Session lifecycle
│   ├── hooks.json               #   Hook event configuration
│   ├── session-start.mjs        #   Init tracking, create session record
│   └── session-end.mjs          #   Finalize record, git backup
│
├── .claude-plugin/              # NEW: Plugin manifest
│   └── plugin.json              #   Declares MCP + hooks + skill
│
├── skills/brag-sheet/SKILL.md   # Works everywhere (EXISTING)
└── package.json                 #   Add "mcp-server" to bin field
```

## Key Research Findings

### Agency Platform (1esgitops/_git/agency)

- **Agency is a thin wrapper** around Copilot CLI and Claude Code, providing Microsoft-specific integrations
- **Engine-agnostic plugins:** One plugin works with both `agency copilot` and `agency claude`
- **Plugin format:** Uses `.claude-plugin/plugin.json` (Claude Code native format)
- **MCP in plugins:** Plugins can bundle `.mcp.json` or declare MCP servers in agent frontmatter
- **Hooks in plugins:** `hooks.json` files are passed to whichever engine is running
- **Distribution:** `agency plugin install market:<name>@<marketplace>` — no full repo clone
- **npx support:** `agency mcp npx` can launch MCP servers via npx (zero-install distribution!)
- **Env vars:** `AGENCY_PLUGIN_DIR` (plugin root), `AGENCY_REPO_DIR` (repo root) available in hooks
- **`--engine` flag:** Can restrict plugins to specific engines (additive)
- **Source redirects:** Marketplace stubs can point to external repos (our GitHub repo!)

### MCP Protocol

- **Stdio-based:** MCP server is a Node.js process that reads/writes JSON-RPC over stdin/stdout
- **Tools:** Each tool has a name, description, and JSON schema for parameters
- **Universal:** Same MCP server works with Copilot CLI, Claude Code, VS Code, Codex CLI
- **npm SDK:** `@modelcontextprotocol/sdk` provides Server class, tool registration, stdio transport
- **No auth needed:** For local tools (our case), no auth layer required

### Cross-Engine Compatibility

| Feature | Copilot CLI | Claude Code | Agency |
|---------|-------------|-------------|--------|
| SKILL.md | ✅ | ✅ | ✅ |
| agents/*.md | ✅ | ✅ | ✅ |
| hooks.json | ✅ | ✅ | ✅ (passes to engine) |
| MCP servers | ✅ | ✅ | ✅ (via plugin or --mcp) |
| extension.mjs | ✅ | ❌ | ❌ |
| .claude-plugin/plugin.json | ❌ | ✅ | ✅ |

### What the MCP Server Exposes (3 tools)

1. **save_to_brag_sheet** — Save a work entry (summary, category, impact, tags, repo, branch)
2. **review_brag_sheet** — Read recent entries (weeks parameter)
3. **generate_work_log** — Render markdown work log to disk

### What Hooks Handle

1. **session_start** — Detect data dir, load config, create session record, start tracking
2. **session_end** — Finalize session record (duration, files), write to storage, git backup

### Distribution Strategy

**Phase 1: Agency Plugin (internal)**
```bash
# XPASS marketplace (existing PR #15395414 — upgrade from skill-only to full plugin)
agency plugin install market:brag-sheet@https://dev.azure.com/microsoft/Xbox.Streaming/_git/services.agency.plugins

# Or via source redirect pointing to microsoft/copilot-brag-sheet
```

**Phase 2: Public Claude Code Plugin**
```bash
# Direct from GitHub
claude plugin install github:microsoft/copilot-brag-sheet

# Or via npx (zero install)
claude mcp add --transport stdio brag-sheet -- npx copilot-brag-sheet mcp-server
```

**Phase 3: npm + npx**
```bash
# Any MCP-compatible client
npx copilot-brag-sheet mcp-server
```

## What's Reusable (90% of code)

All 6 lib modules stay pure Node.js with no runtime dependencies (only the MCP server adds `@modelcontextprotocol/sdk` + `zod`):
- `lib/paths.mjs` — data dir detection (OS-specific app-data)
- `lib/config.mjs` — presets (microsoft, default), categories, user context
- `lib/storage.mjs` — JSON record I/O (atomic writes, crash recovery)
- `lib/records.mjs` — record creation, field sanitization, dedup
- `lib/render.mjs` — markdown generation (work log, review summary)
- `lib/git-backup.mjs` — auto-commit + push to private repo

## What Needs Building

### 1. MCP Server (`mcp-server.mjs`) — ~400-450 lines
- Built on `@modelcontextprotocol/sdk` with `zod` for strict input schemas
- Register 3 tools (camelCase output schemas, tool annotations, response_format)
- Each tool handler calls into lib/ modules
- Stdio transport (stdin/stdout)

### 2. Hooks (`hooks/`) — ~50-80 lines each
- `hooks.json` — declares session_start and session_end events
- `session-start.mjs` — init data dir, load config, create session record stub
- `session-end.mjs` — finalize record, write to storage, trigger git backup
- Challenge: hooks are shell scripts in Claude Code but can call `node hooks/session-start.mjs`

### 3. Plugin Manifest (`.claude-plugin/plugin.json`)
- Declares: skills, hooks, MCP server
- References: `skills/brag-sheet/SKILL.md`, `hooks/hooks.json`, MCP config

### 4. Package.json Updates
- Add `"mcp-server"` to `bin` field for npx distribution
- Add `@modelcontextprotocol/sdk` and `zod` as runtime deps (decided in [decisions doc](./cross-engine-decisions.md#1-zero-dep-vs-sdk--use-the-official-mcp-sdk--zod))

## Open Questions

1. **Zero-dep vs SDK:** ✅ Resolved — adopt `@modelcontextprotocol/sdk` + `zod`. See [decisions doc](./cross-engine-decisions.md#1-zero-dep-vs-sdk--use-the-official-mcp-sdk--zod).
2. **Hook state persistence:** Hooks run as separate processes — how to share session state between session_start and session_end? (Options: temp file, env var, PID-keyed storage)
3. **File tracking in hooks:** Can Claude Code hooks observe file edits? Or do we only get session start/end?
4. **Backward compat:** Should `install.ps1`/`install.sh` detect engine type and wire both extension.mjs AND MCP server?
5. **Version:** v1.1.0 (additive) or v2.0.0 (if plugin manifest changes package structure)?

## Test Plan

- Unit tests for MCP server tool handlers (mock stdin/stdout)
- Unit tests for hook scripts (mock lib/ calls)
- Integration test: MCP server responds to JSON-RPC tool calls
- Integration test: hooks create/finalize session records
- E2E test: `agency claude --plugin local:. --mcp brag-sheet` → save/review/generate works
- Cross-platform: Windows + macOS + Linux (CI matrix already exists)

## References

- Agency repo: `https://dev.azure.com/1esgitops/_git/agency`
- Agency plugin docs: `docs/agency/Tools/Plugins/plugins.md`
- Agency MCP docs: `docs/agency/Tools/MCP/mcp.md`
- Agency custom agents + MCP: `docs/agency/Tools/CustomAgents/mcp-servers.md`
- MCP protocol spec: https://modelcontextprotocol.io/
- Claude Code plugin ref: https://code.claude.com/docs/en/plugins-reference
- Issue tracking: microsoft/copilot-brag-sheet#22
- awesome-copilot skill: merged (PR #1428)
- XPASS skill submission: services.agency.plugins PR #15395414
- Copilot CLI bug (extension loading): github/copilot-cli#3023

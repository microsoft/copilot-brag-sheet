# Roadmap

Prioritized by user impact. Contributions welcome — open an issue to discuss.

## Priority 0 — Cross-engine (post-FHL Spring 2026)

The biggest distribution unlock. See [`docs/cross-engine-spec.md`](docs/cross-engine-spec.md).

- [ ] **MCP server** (`mcp-server.mjs`) — wraps the existing `lib/` modules in MCP protocol so any MCP-compatible client (Copilot CLI, Claude Code, VS Code, Codex) can use the tools
- [ ] **Hooks** (`hooks/`) — `session-start.mjs` + `session-end.mjs` for cross-engine session tracking
- [ ] **Plugin manifest** (`.claude-plugin/plugin.json`) — declares skills, hooks, MCP server
- [ ] **Phase 1 — Agency plugin** (internal MSFT) — ship to Xbox engineers via XPASS marketplace; works with both `agency copilot` AND `agency claude`
- [ ] **Phase 2 — Public Claude Code plugin** — `claude plugin install github:microsoft/copilot-brag-sheet`
- [ ] **Phase 3 — npm + npx** — `npx copilot-brag-sheet mcp-server` for any MCP client

## Priority 1 — Discoverability

- [x] **Git backup** — Opt-in auto-commit of work log to a git repo (`lib/git-backup.mjs`)
- [x] **Git backup remote sync** — Connect data dir git repo to a remote (GitHub/ADO) for cross-machine sync
- [x] **awesome-copilot skill** — Listed via PR #1428 (merged April 2026)
- [x] **npm publish** — Published as `copilot-brag-sheet` (v1.0.1)

### Blocked on upstream

- [ ] **`copilot plugin install` support for `joinSession()` extensions** — tracking [github/copilot-cli#3023](https://github.com/github/copilot-cli/issues/3023). When fixed, we can distribute via the Copilot CLI plugin marketplace as a one-line install. Until then, manual install scripts (`install.ps1`/`install.sh`) are the only supported path for the auto-tracking functionality. Mitigation in flight: cross-engine MCP + hooks via Agency (see Priority 0).

## Priority 3 — Features

- [ ] **Summary inference** — Auto-generate session summaries from context (issue #7)
- [ ] **Date range filtering** — `review_brag_sheet` with custom date ranges (not just weeks) (issue #8)
- [ ] **Export formats** — CSV and JSON export for work log data (issue #4)

## Priority 4 — Personalization

- [ ] **User-defined tracking preferences** — `impactDefinition`, `trackingFocus`, `outputFormat` fields in config.json
- [ ] **STAR output format** — Situation/Task/Action/Result template for entries (issue #9)
- [ ] **Additional presets** — Beyond Microsoft (e.g., Google, generic startup)

## Priority 5 — Hardening

- [ ] **Case-insensitive path dedup** — Windows/macOS case-insensitive file path deduplication
- [ ] **UNC path handling** — Fix `normalizePath` for Windows UNC paths (`\\server\share`)

## Non-Goals

These are intentionally out of scope:

- **Cloud storage backend** — local-first tool; use cloud sync (OneDrive/Dropbox) instead
- **Runtime dependencies** — zero-dependency constraint is a feature
- **Telemetry or analytics** — no data leaves your machine
- **Multi-user features** — personal productivity tool

# Roadmap

Prioritized by impact ÷ effort. Contributions welcome — open an issue to discuss.

> **Last updated:** 2026-05-26.

## Priority 0 — Product completeness & distribution (next 2 weeks)

The README promises "automatic" capture but the tool currently requires saying "brag —". Closing that gap is the highest-value work.

- [ ] **Summary inference** — auto-detect significant work from session signals (PR opened, on-call resolved, design merged) and prompt the user to save. Closes the README's "automatic" promise. [#7](https://github.com/microsoft/copilot-brag-sheet/issues/7)
- [ ] **Publish dev.to blog post** — draft at [`docs/blog-post-devto.md`](docs/blog-post-devto.md). Publish with canonical link back to the repo README.
- [ ] **GitHub Pages landing page with structured data** — JSON-LD `SoftwareApplication` + `HowTo` schema and OpenGraph tags so search results and link previews are accurate.
- [ ] **OpenGraph image** for share previews in Slack/Teams.
- [ ] **Source attribution** — request source links where SKILL.md is mirrored on third-party sites without attribution.
- [ ] **Submit SKILL.md to additional skill registries** — public catalogs that accept community submissions (e.g. awesome-* lists).
- [ ] **Internal Microsoft channels** — share the project in relevant Microsoft engineering and Connect-prep channels.

## Priority 1 — Cross-engine support

See [`docs/cross-engine-spec.md`](docs/cross-engine-spec.md).

- [x] **MCP server** (`mcp-server.mjs`) — wraps the existing `lib/` modules in MCP protocol so any MCP-compatible client (Copilot CLI, Claude Code, VS Code, Codex) can use the tools. Shipped in v1.1.0.
- [x] **Plugin manifest** (`.claude-plugin/plugin.json`) — declares skills, hooks, MCP server. Shipped in v1.1.0.
- [x] **Phase 1 — Agency plugin** (internal MSFT) — `agency.json`, `.mcp.json`, `hooks/hooks.json`, `hooks/post-tool-use.mjs`. Classification-only PostToolUse hook via `lib/heuristics.mjs`. Shipped in v1.2.0.
- [ ] **Phase 2 — Session persistence** — `session-start.mjs` + `session-end.mjs` hooks for cross-engine session tracking. Requires session-key strategy (see `docs/cross-engine-spec.md` Phase 2 invariants).
- [ ] **Phase 3 — Public Claude Code plugin** — `claude plugin install github:microsoft/copilot-brag-sheet`
- [ ] **Phase 4 — npm + npx** — `npx copilot-brag-sheet mcp-server` for any MCP client

## Shipped

- [x] **v1.2.0** — Agency plugin manifests (Phase 1), PostToolUse classification hook, extracted `lib/heuristics.mjs` + `lib/operations.mjs`, session summary `taskDescription` fallback fix. 184 tests.
- [x] **v1.1.0** — MCP server (`mcp-server.mjs`) with Zod schemas, Claude Code plugin manifest, cross-engine spec
- [x] **v1.0.3** — install bug fixes, README rewrite, plugin.json drift fix, peerDeps declaration, tarball validation in CI
- [x] **v1.0.2** — Windows PS 5.1 install fix, npm install path (`bin/install.mjs`), Windows ESM URL fix in setup, install-smoke CI matrix, npm publish via release.yml
- [x] **awesome-copilot skill** — listed via PR #1428 (merged April 2026)
- [x] **npm publish** — published as `copilot-brag-sheet` (v1.0.0 → v1.0.3)
- [x] **Git backup** — opt-in auto-commit of work log to a git repo
- [x] **Git remote sync** — connect data dir git repo to a remote (GitHub/ADO) for cross-machine sync

### Blocked on upstream

- [ ] **`copilot plugin install` support for `joinSession()` extensions** — tracking [github/copilot-cli#3023](https://github.com/github/copilot-cli/issues/3023) (in-repo: [#23](https://github.com/microsoft/copilot-brag-sheet/issues/23)). When fixed, distribution becomes one line. Mitigation in flight: cross-engine MCP + hooks.

## Priority 2 — Polish (after distribution proven)

- [ ] **Trusted Publishing migration** — replace `NPM_TOKEN` with OIDC; closes the `_npmUser` vs `author:Microsoft` chain-of-trust gap. Defer until >100 weekly installs.
- [ ] **`mktemp -d` staging in install.sh** — atomic install (current `rm -rf` before clone is real upgrade-path regression risk if clone fails)
- [ ] **EBUSY handling on Windows in-place upgrade** — `bin/install.mjs:rmSync` throws if Copilot CLI is running
- [ ] **ANSI escape gating** — `isTTY && !process.env.NO_COLOR`
- [ ] **Verify extension actually loads** in `copilot -p` and other contexts (with `BRAG_SHEET_DEBUG=1` debug log added in v1.0.3)

## Priority 3 — Features (issue tracker)

- [ ] **Date range filtering** — `review_brag_sheet` with custom date ranges (issue [#8](https://github.com/microsoft/copilot-brag-sheet/issues/8))
- [ ] **Export formats** — CSV and JSON export (issue [#4](https://github.com/microsoft/copilot-brag-sheet/issues/4))
- [ ] **STAR output format** — Situation/Task/Action/Result template (issue [#9](https://github.com/microsoft/copilot-brag-sheet/issues/9))
- [ ] **User-defined tracking preferences** — `impactDefinition`, `trackingFocus`, `outputFormat` in config.json
- [ ] **Additional presets** — beyond Microsoft (e.g., generic startup, Google)

## Priority 4 — Hardening

- [ ] **Case-insensitive path dedup** — Windows/macOS file path deduplication
- [ ] **UNC path handling** — fix `normalizePath` for `\\server\share`

## Non-Goals

These are intentionally out of scope:

- **Cloud storage backend** — local-first; use cloud sync (OneDrive/Dropbox) instead
- **Heavy runtime dependencies** — minimal-dep constraint is a feature; only the official MCP SDK + Zod are accepted (for spec conformance)
- **Telemetry or analytics** — no data leaves your machine
- **Multi-user features** — personal productivity tool
- **In-product `update-notifier`** — would corrupt agent transcripts (extension stdio is the host's tool-output channel) AND adds a runtime dep with no protocol-conformance benefit. Use `npm update -g` instead.

# Roadmap

Prioritized by impact ÷ effort. Contributions welcome — open an issue to discuss.

> **Last updated:** 2026-05-01 — reflects post-FHL distribution data + competitive analysis. We have ~218 unique visitors / 53 unique cloners in 14 days from awesome-copilot, and one organic user already (krishra). The next priorities are about converting that traffic, not polishing install scripts.

## Priority 0 — Distribution & product moat (next 2 weeks)

The pitch promises "automatic" but the tool requires saying "brag —". Closing that gap **and** pushing on distribution moves the project further than any installer polish.

- [ ] **Summary inference** — auto-detect significant work from session signals (PR opened, on-call resolved, design merged) and prompt the user to save. Closes the README's "automatic" promise. Also the differentiator vs Microsoft's `whatidid` skill (retrospective only). [#7](https://github.com/microsoft/copilot-brag-sheet/issues/7)
- [ ] **Publish dev.to blog post** — draft already exists at [`docs/blog-post-devto.md`](docs/blog-post-devto.md). Publish with canonical link to README. Visibility window from awesome-copilot is open NOW.
- [ ] **GitHub Pages landing page with structured data** — JSON-LD `SoftwareApplication` + `HowTo` schema, OG tags. Goal: outrank third-party scrapers (claudskills.com) on Google searches for "brag sheet copilot".
- [ ] **OpenGraph image** for share previews in Slack/Teams/Twitter.
- [ ] **Reclaim attribution from claudskills.com** — they re-host our SKILL.md with no source link behind a $9/mo paywall. Polite request for attribution = free SEO backlink.
- [ ] **Submit SKILL.md to other Claude/skill registries** — anthropic-skills awesome lists, Glama, Smithery, awesome-claude-skills. ~1 hr total.
- [ ] **Share internally** — Microsoft Teams already shows up as a top traffic referrer organically. Post deliberately in XPP, AI org, FHL, Connect-prep channels.

## Priority 1 — Cross-engine support (Agency + Claude Code)

The biggest distribution unlock. See [`docs/cross-engine-spec.md`](docs/cross-engine-spec.md).

- [ ] **MCP server** (`mcp-server.mjs`) — wraps the existing `lib/` modules in MCP protocol so any MCP-compatible client (Copilot CLI, Claude Code, VS Code, Codex) can use the tools. Resolve the spec's 5 open questions first.
- [ ] **Hooks** (`hooks/`) — `session-start.mjs` + `session-end.mjs` for cross-engine session tracking
- [ ] **Plugin manifest** (`.claude-plugin/plugin.json`) — declares skills, hooks, MCP server
- [ ] **Phase 1 — Agency plugin** (internal MSFT) — upgrade XPASS PR from skill-only to full plugin
- [ ] **Phase 2 — Public Claude Code plugin** — `claude plugin install github:microsoft/copilot-brag-sheet`
- [ ] **Phase 3 — npm + npx** — `npx copilot-brag-sheet mcp-server` for any MCP client

## Shipped

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
- **Runtime dependencies** — zero-dependency constraint is a feature
- **Telemetry or analytics** — no data leaves your machine
- **Multi-user features** — personal productivity tool
- **In-product `update-notifier`** — would corrupt agent transcripts (extension stdio is the host's tool-output channel) AND breaks zero-deps promise. Use `npm update -g` instead.

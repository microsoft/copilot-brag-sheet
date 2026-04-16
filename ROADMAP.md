# Roadmap

Prioritized by user impact. Contributions welcome — open an issue to discuss.

## Priority 1 — Discoverability

- [x] **Git backup** — Opt-in auto-commit of work log to a git repo (`lib/git-backup.mjs`)
- [x] **Git backup remote sync** — Connect data dir git repo to a remote (GitHub/ADO) for cross-machine sync
- [ ] **Submit to awesome-copilot** — Get listed on [awesome-copilot.github.com](https://awesome-copilot.github.com) for discoverability
- [ ] **npm publish** — Enable `npx copilot-brag-sheet` as an alternative install method

> **Note on `copilot plugin install`:** The Copilot CLI plugin system currently only loads skills, agents, and MCP servers — not `joinSession()` extensions. Our install scripts (which copy to `~/.copilot/extensions/`) are the correct install method. We'll revisit when the CLI adds extension support to the plugin system.

## Priority 3 — Features

- [ ] **Summary inference** — Auto-generate session summaries from context
- [ ] **Date range filtering** — `review_brag_sheet` with custom date ranges (not just weeks)
- [ ] **Export formats** — CSV and JSON export for work log data

## Priority 4 — Personalization

- [ ] **User-defined tracking preferences** — `impactDefinition`, `trackingFocus`, `outputFormat` fields in config.json
- [ ] **STAR output format** — Situation/Task/Action/Result template for entries
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

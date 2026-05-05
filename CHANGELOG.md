# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.3] — 2026-05-01

### Fixed

- **`plugin.json` version drift** — was hardcoded to `1.0.0` while `package.json` had moved to `1.0.2`. Removed the duplicate `version` field; `package.json` is now the single source of truth.
- **`bin/setup.mjs` non-TTY hang** — calling the wizard headless (CI, Docker, `< /dev/null`) used to block forever on the first prompt. Now exits cleanly with code 2 and a helpful message pointing at `config.json`.
- **README curl one-liner** — replaced `curl -sL` with `curl -fsSL` so HTTP errors fail loudly instead of piping HTML into bash.

### Added

- **`@github/copilot` declared as optional `peerDependency`** — extension imports `@github/copilot-sdk/extension` which the Copilot CLI host injects at load time. Declaring it (with `optional: true`) gives static-analysis tools and `depcheck` a hook without forcing install on end users.
- **`copilot-brag-sheet-setup` bin** is now the recommended way to re-run the wizard (no more remembering the absolute path).
- **`COPILOT_HOME` documented** in the README's Environment Variables section.
- **`BRAG_SHEET_DEBUG=1` env var** — when set, `extension.mjs` logs to stderr at module load and `onSessionStart` so you can verify the host actually loaded the extension.
- **README rewrite**:
  - Stronger hero hook ("Turn vague *what did I do?* into evidence-backed impact statements")
  - New "**Why an extension, not just a SKILL.md?**" section that explains what the extension provides over the prompt alone: deterministic capture, structured storage, typed tool contracts
  - "**When the agent will use this**" section listing the trigger phrases
- **CI: tarball validation** — `release.yml` now checks `npm pack --dry-run` against a required-files list before publishing. Catches future cases where a new `lib/foo.mjs` gets added but isn't in `package.json`'s `files` whitelist.
- **`prepublishOnly` script** — runs `npm test` automatically on local `npm publish` to prevent accidental untested releases.

### Changed

- **ROADMAP.md restructured** — Priority 0 is now product completeness and distribution (summary inference, blog post, landing page). Cross-engine moved to Priority 1. Packaging polish moved to Priority 2.
- **Removed dead code** in `bin/install.mjs` (`SKIP` set defined but never used; `pathToFileURL` imported then voided).

## [1.0.2] — 2026-05-01

### Fixed

- **Windows install** — `install.ps1` failed on Windows PowerShell 5.1 (default on Windows 10/11) because the `Join-Path` 3-argument form requires PowerShell 6+. Replaced with nested 2-argument calls so the script works on both PS 5.1 and PS 7+ ([#23](https://github.com/microsoft/copilot-brag-sheet/issues/23) follow-up)
- **Setup wizard on Windows + Node 22+** — `bin/setup.mjs` failed with `ERR_UNSUPPORTED_ESM_URL_SCHEME` because dynamic `import()` requires `file://` URLs on Windows. Now uses `pathToFileURL()`.

### Added

- **`npm install` install path** — new `bin/install.mjs` makes `npm install -g copilot-brag-sheet` followed by `copilot-brag-sheet` a fully working install path. Copies extension files to `~/.copilot/extensions/` and runs the setup wizard.
- **`copilot-brag-sheet-setup` bin** — re-run the setup wizard anytime without remembering the absolute path.
- **README demo GIF** — embedded terminal-only animation (`demo/demo.gif`) showing the brag → save → review flow.
- **Awesome Copilot** — listed on [github/awesome-copilot](https://github.com/github/awesome-copilot) ([PR #1428](https://github.com/github/awesome-copilot/pull/1428)).
- **CI: Windows install smoke test** — exercises `install.ps1` on Windows runners so this category of bug can't regress.
- **README rewrite** — clearer install ranking (npm vs script), Microsoft-engineer hop link, trust ribbon, `copilot plugin install` warning hoisted from FAQ to install section, internals collapsed under `<details>`.

### Changed

- **Quick Start install section** — now ranks options as Recommended (script), Alternative (npm), and For contributors (clone) rather than presenting all three equally.

## [1.0.1] — 2025-04-21

### Fixed

- **npm metadata** — repository URL now correctly points to `microsoft/copilot-brag-sheet`

### Added

- **Release workflow** — automated GitHub Releases from version tags (`release.yml`)
- **PR template** — standardized pull request format
- **Release process docs** — versioning and release steps in CONTRIBUTING.md

### Changed

- **Skill v1.1** — major SKILL.md enhancement:
  - Expanded frontmatter description with 25+ trigger phrases
  - Quick Start table, Agent Behavior Rules, Anti-Patterns table
  - Evidence Ladder, Output Contract, Gotchas section
  - Executable backfill commands (git log, gh pr list)

## [1.0.0] — 2025-04-14

Complete rewrite with modular architecture, comprehensive testing, and cross-platform support.

### Added

- **Modular library architecture** — 6 focused modules (`paths`, `config`, `lock`, `storage`, `records`, `render`)
- **Copilot CLI extension** (`extension.mjs`) with hooks and tools
- **Session auto-tracking** — repo, branch, files edited/created, PRs, git actions
- **Three agent tools**: `save_to_brag_sheet`, `review_brag_sheet`, `generate_work_log`
- **Crash-safe storage** — atomic writes (tmp → fsync → rename), file locking, orphan recovery
- **Cross-platform data dirs** — Windows (`%LOCALAPPDATA%`), macOS (`~/Library/Application Support`), Linux (`$XDG_DATA_HOME`)
- **Sharded JSON storage** — `sessions/YYYY/MM/` and `entries/YYYY/MM/` for efficient reads
- **Configurable categories** — 9 built-in + custom via `config.json`
- **Markdown rendering** — weekly grouped output with category sections
- **"brag" keyword detection** — prompts the agent to call `save_to_brag_sheet`
- **Emergency shutdown saves** — captures session state on unexpected exit
- **Orphan session recovery** — detects stale sessions from crashed processes
- **Git version history** — opt-in auto-commit of work log data to a local git repo
- **Git remote sync** — connect data dir to a private GitHub/ADO repo for cross-machine sync
- **Install scripts** (`install.sh`, `install.ps1`) with interactive setup wizard (`bin/setup.mjs`)
- **Cloud sync support** — `WORK_TRACKER_DIR` env var for OneDrive/Dropbox/iCloud
- **107 tests** covering all modules and extension logic
- **Zero runtime dependencies** — Node.js 18+ only

### Changed (from v0.x)

- Rewrote from single-file monolith to modular library
- Storage changed from flat files to sharded year/month directories
- Records are now typed JSON (`session` and `entry` types)
- Markdown is generated on-demand instead of written on every session end
- Data directory moved from `~/Documents/work-tracker` to OS-native app-data paths
- Environment variable `WORK_TRACKER_BRAG_SHEET` renamed to `WORK_TRACKER_OUTPUT_PATH` (old name still works)

### Removed

- OneDrive auto-detection (use `WORK_TRACKER_DIR` instead)
- Inline Markdown editing (Markdown is now generated output only)

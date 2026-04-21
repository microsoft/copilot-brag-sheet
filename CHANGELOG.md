# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

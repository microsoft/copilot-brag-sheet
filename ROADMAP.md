# Roadmap

Prioritized by impact ÷ effort. Contributions welcome — open an issue to discuss.

> **Last updated:** 2026-11-13.

## Product direction

Capture permitted work with minimal daily effort, help the user turn it into
evidence-backed contributions, and preserve accepted records for later reviews.
AI drafts the wording; the user controls acceptance and corrects attribution or
missing context. Recorded activity does not by itself establish impact.

### Capability map

| Capability | Available today | Direction to evaluate |
| --- | --- | --- |
| Automatic activity capture | Supported native Copilot CLI session, file, PR and git events | Useful milestone prompts; explicit capture scope and retained-field controls |
| AI-assisted descriptions | Host-assisted saves, opt-in PR contribution drafts, and captured task/session descriptions | Evaluate other meaningful milestones without a separate model service |
| Durable contributions | Local JSON entries, atomic writes and keyed retry deduplication | Explicit correction/deletion workflows and reconciliation that preserves user decisions |
| Evidence | PR references and file activity in session records | Contribution-linked evidence; optional user-selected attachments |
| Review and export | Markdown review and generated work logs; configurable session visibility | Useful first review, related-work grouping, additional export formats and optional visual reports |
| Data control and recovery | Local storage and optional Git backup; raw sessions excluded from generated Git ignore rules | Capture consent, retention, inspect/delete and explicit export/backup scope; recovery checks |
| Installation and interoperability | Native Copilot plugin and standalone MCP tools | Keep Copilot setup reliable; broaden engine support only after the core experience is useful |

These are product directions, not promises of current functionality. In
particular, metadata-only capture, durable correction handling, and automatic
accomplishment inference are not implemented. Existing capture can retain
prompt-derived descriptions; generated logs can contain session-derived text
even when raw session files are excluded from Git.

### Small increments, separately approved

1. **PR milestone nudge:** after a confirmed supported PR-creation event, offer
   one concise, grounded contribution draft with save/edit/skip. Do not equate
   opening a PR with shipping, and do not save a contribution without acceptance.
   Keep existing capture, export and backup behavior unchanged.
2. **Useful first review:** make captured work discoverable when the user asks
   for a review, distinguish it from accepted entries, and support drafting
   without requiring a manual save after every task.
3. **Capture and record controls:** scope consent, retained fields, corrections,
   deletion and backup behavior before recommending broader sensitive-work use.
   This is a separate design, not an implicit addition to the nudge.

Validate each increment before expanding it. Timelines, attachments, additional
sources and broader inference remain candidates, not an implementation queue.

## Priority 0 — Product completeness & distribution

Automatic activity capture is implemented, but captured activity is not the same
as a saved contribution or verified impact. The first bounded milestone is an
opt-in PR contribution draft; broader capture and review work remain separate.

- [x] **Opt-in PR milestone nudge** — bounded native-host guidance for a grounded draft after supported GitHub PR creation, with conversational acceptance and resume suppression. Synthetic interactive-host delivery is verified; presentation remains best effort. Shell PR commands are not supported. See [configuration and limitations](README.md#optional-pr-contribution-drafts).
- [ ] **First-review usefulness** — make existing captured activity discoverable during review, distinguish it from saved contributions, and guide evidence-backed drafting. Respect explicit visibility choices; do not add capture sources or change export and backup defaults.
- [ ] **Broader summary inference** — after validating the bounded PR nudge and first-review experience, evaluate other significant work boundaries. Distinguish observed activity from confirmed outcomes and leave unsupported impact unknown. [#7](https://github.com/microsoft/copilot-brag-sheet/issues/7)
- [x] **Capture reliability** — align with current Copilot SDK hook payloads, track `apply_patch`, preserve resumed sessions, isolate subagent lifecycle events, expose capture health, and make entry retries idempotent.
- [ ] **Publish dev.to blog post** — draft at [`docs/blog-post-devto.md`](docs/blog-post-devto.md). Publish with canonical link back to the repo README.
- [x] **GitHub Pages landing page with structured data** — JSON-LD `SoftwareApplication` + `HowTo` schema and OpenGraph tags so search results and link previews are accurate.
- [x] **OpenGraph image** for share previews in Slack/Teams.
- [ ] **Source attribution** — request source links where SKILL.md is mirrored on third-party sites without attribution.
- [ ] **Submit SKILL.md to additional skill registries** — public catalogs that accept community submissions (e.g. awesome-* lists).
- [ ] **Internal Microsoft channels** — share the project in relevant Microsoft engineering and Connect-prep channels.

## Priority 1 — Cross-engine support

See [`docs/cross-engine-spec.md`](docs/cross-engine-spec.md).

- [ ] **Refresh packaging against Agent Plugins 1.0** — keep portable skills/MCP at the plugin root, put Copilot-specific hooks under `com.github.copilot/`, and retain `extension.mjs` only for interactive CLI event capture.
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

### Plugin distribution

- [x] **Copilot plugin distribution** — current CLI supports plugin extensions. A GitHub-backed marketplace installs the native adapter without npm publication. Experimental features and hook approval remain required.
- [x] **Verify remote rollout** — isolated Windows checks installed the candidate from its GitHub branch, updated to a newer commit, and verified saved records were unchanged. Default-branch availability follows merge.

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

### Ideas to revisit — not committed scope

These possibilities are deferred until the core capture-to-review workflow is
useful with minimal user effort. They do not require a new application or
storage redesign as part of the immediate work.

- [ ] **Contribution evidence** — associate PR links and artifact references with saved contributions; distinguish links from retained local copies.
- [ ] **Optional attachments** — attach user-selected screenshots and documents with explicit retention and backup choices. No automatic screen capture or implicit upload.
- [ ] **Project timelines** — suggest related contributions across sessions and show progress over time, with user-correctable grouping rather than a manually maintained project board.
- [ ] **On-demand visual review** — explore a local visual report generated from existing records, without requiring an always-running dashboard.

Evidence and metadata can contain sensitive information. Any future attachment,
collection, or backup expansion needs a separate scope and privacy review.

## Priority 4 — Hardening

- [x] **Guarded dependency patch maintenance** — monitor through Dependabot, automatically merge narrowly scoped patches after complete CI, and escalate other changes. [#85](https://github.com/microsoft/copilot-brag-sheet/issues/85)
- [ ] **Case-insensitive path dedup** — Windows/macOS file path deduplication
- [ ] **UNC path handling** — fix `normalizePath` for `\\server\share`

## Non-Goals

These are intentionally out of scope:

- **Cloud storage backend** — local-first; use cloud sync (OneDrive/Dropbox) instead
- **Heavy runtime dependencies** — minimal-dep constraint is a feature; only the official MCP SDK + Zod are accepted (for spec conformance)
- **Telemetry or analytics** — no data leaves your machine
- **Multi-user features** — personal productivity tool
- **In-product `update-notifier`** — would corrupt agent transcripts (extension stdio is the host's tool-output channel) AND adds a runtime dep with no protocol-conformance benefit. Use `npm update -g` instead.

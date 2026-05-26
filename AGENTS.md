# AGENTS.md

> **README for AI coding agents.** If you're a human looking for setup or
> usage instructions, read [`README.md`](README.md) instead. This file is the
> dedicated place where Claude Code, Copilot CLI, Codex, Cursor, Jules, Amp,
> and friends find the context they need to be productive on this repo
> without re-deriving it from grep.
>
> **Format:** [agents.md](https://agents.md/) — used by 60k+ open-source
> projects and stewarded by the Agentic AI Foundation under the Linux
> Foundation. The closest `AGENTS.md` to the file you're editing wins;
> explicit prompts override everything.

---

## 1. Project overview

`copilot-brag-sheet` is a [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli)
extension that silently records work as it happens — files edited, PRs
created, git actions, manual brag entries — into structured local JSON so a
developer has receipts at performance review time instead of a blank page.
It ships as a [`joinSession()`](https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-with-mcp-and-extensions)
extension installed into `~/.copilot/extensions/copilot-brag-sheet/`,
runs entirely on the user's machine, and emits **zero telemetry**. The
core library (`lib/`) is dependency-free; the cross-engine MCP server
(`mcp-server.mjs`) takes two pinned, audited runtime dependencies — the
official MCP SDK and Zod — to stay protocol-conformant. The user-facing
pitch is:

> Turn vague *what did I do?* into evidence-backed impact statements —
> automatically, every Copilot CLI session.

Public repo: <https://github.com/microsoft/copilot-brag-sheet> ·
npm: [`copilot-brag-sheet`](https://www.npmjs.com/package/copilot-brag-sheet) ·
landing: <https://microsoft.github.io/copilot-brag-sheet/>.

---

## 2. Architecture map

```
Copilot CLI host  ──spawns──▶  extension.mjs (joinSession)
                                    │
                                    ├── hooks: onSessionStart / onUserPromptSubmitted /
                                    │           onPostToolUse / onSessionEnd /
                                    │           session.shutdown
                                    │
                                    ├── tools: save_to_brag_sheet
                                    │          review_brag_sheet
                                    │          generate_work_log
                                    │
                                    └── delegates to lib/* (pure Node, no SDK coupling)
                                            │
                                            ▼
                              JSON records on disk (atomic writes)
                              ~/AppData/Local/copilot-brag-sheet/  (Windows)
                              ~/Library/Application Support/copilot-brag-sheet/  (macOS)
                              ~/.local/share/copilot-brag-sheet/  (Linux, XDG)
                                            │
                                            ▼
                              optional: git commit/push to private repo

Agency host  ──spawns──▶  hooks/post-tool-use.mjs (subprocess per event)
                               │
                               ├── reads JSON payload from stdin
                               ├── classifies via lib/heuristics.mjs
                               └── writes JSON response to stdout
                                   (Phase 1: classification only, no persistence)

MCP host  ──stdio──▶  mcp-server.mjs (@modelcontextprotocol/sdk)
                           │
                           ├── tools: save_to_brag_sheet / review_brag_sheet / generate_work_log
                           └── delegates to lib/operations.mjs
```

**Entry points** (start here):

| File | Role |
|---|---|
| [`extension.mjs`](extension.mjs) | The only file that imports `@github/copilot-sdk/extension`. Wires hooks and tools to `lib/*`. **All Copilot-specific glue lives here and nowhere else.** |
| [`mcp-server.mjs`](mcp-server.mjs) | MCP stdio server exposing all three tools. Uses `@modelcontextprotocol/sdk` + `zod`. Works with any MCP-compatible host. |
| [`hooks/post-tool-use.mjs`](hooks/post-tool-use.mjs) | Agency PostToolUse hook. Classifies tool calls via `lib/heuristics.mjs`, returns classification to host via stdout. **Phase 1: classification only, no persistence.** |
| [`bin/install.mjs`](bin/install.mjs) | `npm i -g copilot-brag-sheet && copilot-brag-sheet` — copies package files into `~/.copilot/extensions/` and runs setup. |
| [`bin/setup.mjs`](bin/setup.mjs) | Interactive wizard: presets, git backup, output path. Non-TTY exits cleanly (CI-safe). |
| [`install.sh`](install.sh) / [`install.ps1`](install.ps1) | Curl-pipe-bash installers. Cross-platform CI-tested on PS 5.1 and pwsh 7. |

**Core library** (`lib/`) — dependency-free, pure Node, Copilot-agnostic
(safe to import from any entry point):

| Module | Responsibility | Key exports |
|---|---|---|
| [`paths.mjs`](lib/paths.mjs) | OS-native data dir + path helpers; respects `WORK_TRACKER_DIR` / `XDG_DATA_HOME` / `LOCALAPPDATA`. | `detectDataDir`, `detectBragSheetPath`, `detectGitConfig`, `ensureDir` |
| [`config.mjs`](lib/config.mjs) | Loads `config.json`, merges with defaults, surfaces `microsoft` preset context. | `loadConfig`, `getAllCategoryIds`, `isValidCategory`, `buildUserContext`, `DEFAULT_CONFIG` |
| [`heuristics.mjs`](lib/heuristics.mjs) | Tool classification sets, PR/file/git extraction helpers, brag keyword detection, composite `classifyToolUse`. | `FILE_CREATE_TOOLS`, `FILE_EDIT_TOOLS`, `PR_TOOLS`, `SHELL_TOOLS`, `extractFilePath`, `extractPrInfo`, `detectShellGitAction`, `isBragRequest`, `classifyToolUse` |
| [`operations.mjs`](lib/operations.mjs) | Shared validate→create→persist→backup orchestration for all three tools. Returns `{ ok: true/false }` discriminated results. | `saveBragEntry`, `reviewBragEntries`, `generateWorkLog` |
| [`lock.mjs`](lib/lock.mjs) | Cross-platform PID-aware file lock (`O_EXCL` create + stale-process detection). | `withFileLock` |
| [`storage.mjs`](lib/storage.mjs) | Atomic JSON/text writes (tmp → fsync → rename), shard-aware reads, `updateRecord` under lock. | `atomicWriteJSON`, `atomicWriteText`, `writeRecord`, `readRecords`, `updateRecord`, `logError` |
| [`records.mjs`](lib/records.mjs) | Record factories, sanitization, dedupe, file-path normalization. | `createSessionRecord`, `createEntryRecord`, `addFileToRecord`, `sanitize`, `dedupeArray` |
| [`render.mjs`](lib/render.mjs) | JSON records → grouped Markdown (`work-log.md`, review summaries). | `weekOf`, `renderMarkdown`, `renderReviewSummary` |
| [`git-backup.mjs`](lib/git-backup.mjs) | Optional git init / commit / push of the data dir; sessions excluded via auto-generated `.gitignore`. | `ensureGitRepo`, `addRemote`, `hasRemote`, `backupToGit`, `createGitRunner` |

**Records on disk** (sharded by `YYYY/MM`):

```
<dataDir>/
├── sessions/2026/05/2026-05-01T12-34-56.789Z_<sessionId>.json
├── entries/2026/05/2026-05-01T12-35-10.000Z_<uuid>.json
├── config.json                 # user config (preset, categories, git)
├── work-log.md                 # generated; safe to delete and regenerate
├── errors.log                  # appended by logError; never throws
└── .git/                       # only if git backup enabled
```

Full schema reference for each record shape is in [`lib/records.mjs`](lib/records.mjs)
(`createSessionRecord` / `createEntryRecord`). **JSON is the source of
truth; Markdown is regenerated.**

---

## 3. Build / test / lint commands

This repo has **no build step** (ESM runs directly on Node 18+) and **no
linter configured** today. The full toolbox is `node --test`.

```bash
# Run all 177 tests (ubuntu/macos/windows × Node 18/20/22 in CI)
npm test

# Run a single test file
node --test test/storage.test.mjs

# Run a single test by name pattern
node --test --test-name-pattern="atomic" test/storage.test.mjs

# Validate the npm tarball will publish a working package
npm pack --dry-run
```

PowerShell-friendly variants (Windows users):

```powershell
# From repo root
npm test
node --test test\storage.test.mjs

# Run the local install end-to-end into a scratch COPILOT_HOME
$env:COPILOT_HOME = "$env:TEMP\copilot-home-test"
.\install.ps1
Get-ChildItem $env:COPILOT_HOME\extensions\copilot-brag-sheet
```

**Contributors must run `npm install` before `npm test`** because
`mcp-server.mjs` depends on the MCP SDK and Zod (see §4 conventions).
The `lib/` modules and `extension.mjs` themselves remain dependency-free;
only the MCP entry point pulls runtime deps.

---

## 4. Code conventions

These are non-negotiable. Most of them encode hard-won lessons (CI failures,
real bug reports). Don't change them without an issue and discussion first.

- **Minimal, pinned runtime dependencies.** `package.json` has exactly
  two runtime `dependencies`: `@modelcontextprotocol/sdk` (cross-engine
  MCP transport) and `zod` (input/output schema validation in
  `mcp-server.mjs`). Both are required for MCP protocol conformance.
  `lib/*` and `extension.mjs` remain dependency-free — they MUST NOT
  import either package directly. Any new runtime dependency requires
  an issue, a written rationale, and an update to this section in the
  same PR. `peerDependencies` lists the Copilot SDK as `optional`.
- **ESM only.** `.mjs` everywhere, `"type": "module"` in `package.json`.
  No CommonJS. No transpilation. Use `node:`-prefixed imports
  (`node:fs`, `node:path`, `node:crypto`, `node:child_process`).
- **Node 18+ baseline.** No optional chaining gymnastics, but also no
  features newer than what Node 18 LTS supports. Test matrix is
  18 / 20 / 22.
- **Atomic JSON writes.** All disk writes go through
  [`atomicWriteJSON`](lib/storage.mjs) (`open` → `writeFile` → `fsyncSync` →
  `closeSync` → `renameSync`, with `unlinkSync` cleanup on failure).
  Text writes use `atomicWriteText` in the same module. Both live in
  `lib/storage.mjs`.
- **File locking for concurrent writers.** Multi-process safety uses
  [`withFileLock`](lib/lock.mjs) — `O_EXCL` create + PID written into the
  lockfile + 30s stale detection via `process.kill(pid, 0)`. Use it any
  time you mutate an existing record (`updateRecord` already does).
- **Sanitization, always.** Free-text from the LLM/user goes through
  [`sanitize()`](lib/records.mjs) (`lib/records.mjs:50-71`): newlines collapsed,
  `WEEKLY_ENTRIES_*` markers stripped, leading `#`s removed, pipes
  escaped, hard-truncated to 500 chars. Never write raw prompt text into
  a record.
- **Errors are logged, not thrown.** Every hook handler and tool handler
  is wrapped in `try { ... } catch (err) { logError(dataDir, "<context>", err); }`.
  `logError` itself never throws (`lib/storage.mjs:305-313`). The
  extension is a side-channel; **a logging failure must never break the
  user's session.**
- **No `console.log` in `extension.mjs`.** Stdout is the host's JSON-RPC
  channel. Use `await session.log(text, { ephemeral: true })` for
  user-facing messages and `process.stderr.write(...)` (gated on
  `BRAG_SHEET_DEBUG=1`) for debug output.
- **Cross-platform path handling.** Always `path.join`/`path.resolve`,
  never string concatenation. `addFileToRecord` normalizes to forward
  slashes for storage (`lib/records.mjs:118-120`) so output is
  platform-stable.
- **Markdown is generated, never edited.** The `<!-- WEEKLY_ENTRIES_START -->`
  / `<!-- WEEKLY_ENTRIES_END -->` markers in `work-log.md` are reserved.
  Anything outside them is preserved by users; everything inside is
  rewritten on each `generate_work_log`.
- **No new lib modules without updating `release.yml`.** The release
  workflow validates the npm tarball against an explicit allow-list (see
  `.github/workflows/release.yml:57-82`). New `lib/foo.mjs` requires both
  `package.json` `files` and `release.yml` `required` array updates, or
  the publish fails.

---

## 5. Testing strategy

Current state: **184 tests, all green, run cross-platform in CI.** Counts
per file (verify with `Select-String -Pattern '^\s*it\('`):

| File | Tests | Covers |
|---|---:|---|
| `test/heuristics.test.mjs` | 34 | Tool classification sets, extractFilePath, extractPrInfo, detectShellGitAction, isBragRequest (incl. mixed-prompt regression), classifyToolUse. |
| `test/extension.test.mjs` | 32 | Session record lifecycle, file tracking, significant actions, manual entry creation, review/generate flow, brag/PR/git smoke tests (importing from lib/heuristics.mjs). |
| `test/git-backup.test.mjs` | 19 | `ensureGitRepo`, `addRemote`, `backupToGit` with a mocked `git` runner. |
| `test/mcp-server.test.mjs` | 18 | MCP server tool handlers via buildServer(), Zod validation, pagination, structured output. |
| `test/operations.test.mjs` | 16 | Shared saveBragEntry, reviewBragEntries, generateWorkLog with real disk I/O. |
| `test/render.test.mjs` | 15 | Markdown rendering, week boundaries (UTC), category grouping, escaping, taskDescription fallback. |
| `test/storage.test.mjs` | 12 | Atomic JSON/text writes, shard layout, filter semantics, update flow. |
| `test/config.test.mjs` | 9 | Default merge, microsoft preset, category resolution. |
| `test/records.test.mjs` | 8 | Record factories, sanitization, file-path dedup. |
| `test/paths.test.mjs` | 7 | Per-platform data dir resolution, env-var overrides. |
| `test/lock.test.mjs` | 7 | Lock acquisition, stale-PID cleanup, contention. |
| `test/hooks.test.mjs` | 6 | Agency PostToolUse hook subprocess tests: classification, malformed input, stdout purity, camelCase compat. |
| `test/pack-smoke.test.mjs` | 1 | Tarball validation, install simulation. |
| **Total** | **184** | |

**What's covered:**

- Pure helpers in every `lib/` module.
- Storage layer: atomic writes survive simulated failures; shard
  filtering works; bad JSON files are skipped, not fatal.
- Locking: stale locks (dead PID) are cleaned up; contention surfaces
  `EEXIST` correctly.
- Git backup: end-to-end with `execFile` mocked; covers commit/push,
  no-changes path, missing remote, init failure.

**What's intentionally NOT covered (yet):**

- Hooks firing inside a real Copilot SDK runtime — `extension.mjs`
  imports from `@github/copilot-sdk/extension`, which only resolves
  inside the host. We test the pure helpers; integration is currently
  manual smoke testing.
- `bin/setup.mjs` happy path (interactive prompts).
- `install.sh` / `install.ps1` — covered by **install-smoke** matrix in
  CI (Linux, macOS, Windows × PS 5.1 and pwsh 7+) but not by `node --test`.
- Real-process orphan recovery (we cover the `isProcessAlive` branch in
  unit tests, not the cross-process scenario).

**Roadmap to better coverage** lives in [`docs/testing-strategy.md`](docs/testing-strategy.md):
mock-host hooks tests using a fake `joinSession` shim, plus subprocess
nightlies that drive `node extension.mjs` end-to-end through stdio.

When adding tests:

- Use `node:test`'s `describe` / `it`, `node:assert/strict`, and
  `mkdtempSync(join(tmpdir(), "..."))` for isolation.
- Clean up in `after()` hooks; tests must be parallel-safe.
- Mirror the source filename: `lib/foo.mjs` → `test/foo.test.mjs`.
- For anything that touches `process` or `git`, take an injectable
  function parameter so the test can mock it (see
  `createGitRunner` in `lib/git-backup.mjs:34-46` for the pattern).

---

## 6. Security & privacy posture

> **One-line summary:** Local-first, zero telemetry, atomic writes,
> sessions/ excluded from any optional git backup, no secret redaction
> *yet* (planned). Full threat model in [`docs/security-model.md`](docs/security-model.md).

What we **DO** defend against:

- **Crash mid-write** → atomic JSON writes (tmp + fsync + rename) guarantee
  either the old version or the complete new version, never a half-written
  one. OneDrive/iCloud-safe.
- **Concurrent writers** → `withFileLock` with PID + stale detection.
- **Process death** → `session.shutdown` synchronous emergency-save
  (`extension.mjs:558-571`), plus `recoverOrphans` on next boot
  (`extension.mjs:94-116`) marks abandoned sessions instead of leaving
  them `active` forever.
- **Network egress** → there is none. The only network call is the
  optional `git push` if (and only if) the user explicitly opted in via
  the setup wizard *and* configured a remote.
- **Markdown injection** → `sanitize()` strips reserved markers, escapes
  pipes, removes leading `#`, and truncates to 500 chars before any text
  hits `work-log.md`.

What we **do NOT** currently defend against:

- **Secret leakage in records.** If a user types an API key into a
  prompt and the LLM writes it into `summary`, it ends up in the JSON.
  Redaction is on the roadmap.
- **Filesystem snooping by other local users.** Records inherit the OS
  default permissions of the data directory. We don't `chmod 600`.
- **Malicious extensions running in the same Copilot CLI process.**
  We trust the host.

If your change touches data flow, redaction, or any new I/O surface,
update [`docs/security-model.md`](docs/security-model.md) in the same PR.

---

## 7. Release process

This is fully automated by `.github/workflows/release.yml`. Don't hand-publish.

```bash
# 1. Bump version + add CHANGELOG entry in a normal PR
#    Edit:  package.json  →  "version": "1.x.y"
#    Edit:  CHANGELOG.md  →  add ## [1.x.y] — YYYY-MM-DD section
#    Follow https://keepachangelog.com/ format. SemVer rules:
#      - patch:   bug fix, doc, polish
#      - minor:   new feature, backward compat
#      - major:   breaking schema/behavior change

# 2. Merge the PR (squash). CI must be green across 3 OS × 3 Node versions.

# 3. From an up-to-date main, tag and push:
git checkout main && git pull
git tag v1.x.y
git push origin v1.x.y
```

What `release.yml` does on the tag:

1. Reruns the full test matrix.
2. Asserts `tag == package.json.version` (`release.yml:43-50`).
3. Validates the npm tarball includes every required file
   (`release.yml:52-82`).
4. Extracts the matching `CHANGELOG.md` section.
5. Creates the GitHub Release.
6. Runs `npm publish --provenance --access public` using `NPM_TOKEN`.
7. Skips publish if the tag is a pre-release (e.g. `v1.0.0-rc1`).

**Verify after release:** open
<https://www.npmjs.com/package/copilot-brag-sheet>, confirm the new
version is published, and run `npm install -g copilot-brag-sheet@latest`
in a scratch shell to smoke-test the end-to-end install.

**Trusted Publishing** (OIDC) migration is on the [roadmap](ROADMAP.md#priority-2--polish-after-distribution-proven).
Until then, the `_npmUser` is whoever holds the `NPM_TOKEN`, not
`author: Microsoft`.

---

## 8. Distribution channels

| Channel | Status | Surface |
|---|---|---|
| **npm** | ✅ live (`copilot-brag-sheet`) | `npm i -g copilot-brag-sheet && copilot-brag-sheet` runs `bin/install.mjs`. |
| **`install.sh` / `install.ps1`** | ✅ live | One-line curl-pipe-bash from `raw.githubusercontent.com/...`. CI-tested on PS 5.1 + pwsh 7 + bash. |
| **awesome-copilot skill** | ✅ live | [`SKILL.md`](skills/brag-sheet/SKILL.md) is mirrored in [github/awesome-copilot](https://github.com/github/awesome-copilot) (PR #1428). The skill is the prompt; this repo is the prompt **plus** the deterministic capture. |
| **Claude Code plugin** | ✅ partial (tools: v1.1; auto-tracking: Phase 2) | Tracked in [`docs/cross-engine-spec.md`](docs/cross-engine-spec.md). MCP tools work fully; auto-tracking hooks are classification-only (persistence in Phase 2). |
| **MCP server** | ✅ live | `mcp-server.mjs` exposes all three tools to any MCP-compatible host (Cursor, VS Code, Codex, Copilot CLI) via `copilot-brag-sheet-mcp` bin. |
| **`copilot plugin install`** | 🚫 blocked upstream | This is a `joinSession()` extension, not an MCP plugin — needs [github/copilot-cli#3023](https://github.com/github/copilot-cli/issues/3023). Don't try to register it under `~/.copilot/plugins/`. |

Don't add new distribution channels (e.g. Homebrew, scoop, winget)
without first checking the [ROADMAP](ROADMAP.md) — the priority is
proving distribution conversion before fanning out further.

---

## 9. Repo navigation

| Path | Purpose | Modify when... |
|---|---|---|
| `extension.mjs` | Copilot CLI entry point: hooks + tools. **Only file that imports the SDK.** Delegates to `lib/*` for all logic. | Adding a hook or tool. Wiring new lib functionality into the host. |
| `lib/paths.mjs` | OS-native data dir; env-var overrides. | Adding a new path target or platform. |
| `lib/config.mjs` | Default config + presets + category management. | Adding a preset or default category. |
| `lib/heuristics.mjs` | Tool classification sets, extraction helpers, brag keyword detection, composite `classifyToolUse`. | Adding a new tool type to track, changing brag-trigger behavior. |
| `lib/operations.mjs` | Shared save/review/generate orchestration with `{ ok }` returns. Used by extension.mjs, mcp-server.mjs, and future Agency hooks. | Changing save/review/generate behavior across all surfaces. |
| `lib/lock.mjs` | PID-aware file lock. | Don't, unless you have a strong reason. Battle-tested. |
| `lib/storage.mjs` | Atomic JSON/text I/O, shard reads, `updateRecord`. | Adding a new record type or query filter. |
| `lib/records.mjs` | Record factories, `sanitize`, `addFileToRecord`. | Changing the record schema (and read §10 first). |
| `lib/render.mjs` | Records → Markdown. Reserved markers live here. | Changing the work-log Markdown layout. |
| `lib/git-backup.mjs` | Optional git init/commit/push of data dir. | Adding remote types, fixing git edge cases. |
| `mcp-server.mjs` | MCP stdio server (3 tools). Only file that imports `@modelcontextprotocol/sdk` + `zod`. | Adding an MCP tool or changing protocol behavior. |
| `agency.json` | Agency governance manifest (layer 4, developer-tools). **No `version` field** — `package.json` is source of truth. | Changing Agency category, engines, or governance metadata. |
| `.mcp.json` | Standalone MCP server config for Agency hosts. | Changing MCP server args or transport. |
| `hooks/hooks.json` | Agency hook declarations (PostToolUse). | Adding a hook event (e.g. SessionStart, SessionEnd for Phase 2). |
| `hooks/post-tool-use.mjs` | Agency PostToolUse hook. Classifies tool calls via `lib/heuristics.mjs`. **Phase 1: classification only.** | Changing classification behavior or adding persistence (Phase 2). |
| `bin/install.mjs` | Post-`npm-i` wizard launcher. Copies pkg → `~/.copilot/extensions/`. | Changing the install layout or required-files list. |
| `bin/setup.mjs` | Interactive setup wizard. Non-TTY-safe. | Adding a config field, preset, or onboarding step. |
| `install.sh` / `install.ps1` | Curl-pipe-bash installers. | Cross-platform install behavior. PR must include CI smoke updates. |
| `plugin.json` | Plugin manifest (name, source, license). **No `version` field** — `package.json` is source of truth. | Renaming or relicensing. |
| `package.json` | npm metadata, version, `files` allow-list, `bin` map. | Version bumps, adding a published file. |
| `test/*.test.mjs` | `node:test` suites — one per `lib/` module + `extension.test.mjs` for helpers. | Always, when changing behavior. |
| `.github/workflows/ci.yml` | Test matrix + install-smoke matrix. | Adding a platform, Node version, or smoke check. |
| `.github/workflows/release.yml` | Tag-triggered publish + tarball validation. | Adding a `lib/` file (update `required` array) or changing publish flow. |
| `skills/brag-sheet/SKILL.md` | The LLM-facing prompt. Used by awesome-copilot mirror. | Changing brag-trigger behavior or prompt guidance. |
| `docs/cross-engine-spec.md` | MCP + Claude plugin design doc. | Cross-engine work. |
| `docs/testing-strategy.md` | Test coverage map + roadmap (mock host, subprocess tests). | When you add tests or want to. |
| `docs/security-model.md` | Threat model, data flow, redaction plan. | Any change touching new I/O, data fields, or trust boundaries. |
| `docs/backfill-guide.md` | User guide for retro-importing past work. | User-visible backfill behavior. |
| `docs/blog-post-devto.md` | Marketing draft. | Releases / launches. |
| `ROADMAP.md` | Prioritized backlog. **Read before proposing big work.** | When shipping a roadmap item or proposing a new one. |
| `CHANGELOG.md` | Per-version notes. | Every user-visible change. |
| `CONTRIBUTING.md` | Human contributor guide (project structure, code style). | Major repo-level convention changes. |
| `README.md` | Human-facing pitch + install + usage. | User-visible behavior. Keep the strong voice. |
| `demo/` | Marketing assets (GIF, video, slides). Not tracked in tarball. | Launch material. |

---

## 10. Things to NEVER do

> If you're tempted to do any of these, **stop and open an issue first.**

1. **Add a runtime dependency without an issue + rationale.** Two
   pinned deps (the MCP SDK and Zod, both required for protocol
   conformance in `mcp-server.mjs`) is the entire approved list. Any
   third dep needs an issue, a written justification, an audit note,
   and an update to §4 in the same PR. `lib/` and `extension.mjs`
   stay dependency-free regardless.
2. **Write JSON non-atomically.** Always go through
   [`atomicWriteJSON`](lib/storage.mjs:216). A `writeFileSync` straight to
   the final path will eventually corrupt the user's history during a
   crash or OneDrive sync.
3. **Capture telemetry of any kind.** No analytics, no usage pings, no
   crash reporting, no "anonymous opt-in." This is a load-bearing
   promise on the README. If you want to know how many people use the
   tool, read npm's download counter.
4. **Change a record schema field without a migration path.** Old
   `sessions/2025/*/...json` records still need to read cleanly. If you
   rename a field, also handle the old name on read (or write a
   one-shot upgrade in `lib/storage.mjs:readRecords`). Tests in
   `test/storage.test.mjs` should cover both shapes.
5. **`console.log` from `extension.mjs`.** Stdout is the host's JSON-RPC
   channel. You will corrupt the agent's transcript. Use
   `session.log(...)` for user-visible messages and stderr (gated on
   `BRAG_SHEET_DEBUG=1`) for debug.
6. **Add an `update-notifier` or any in-process "you should update" UI.**
   Same reason as above — stdio is sacred. Plus it would break zero
   deps. Users update via `npm update -g`.
7. **Add a runtime dep to `lib/` or `extension.mjs`.** These two
   surfaces stay dependency-free. New runtime deps are only allowed in
   `mcp-server.mjs` and need the §4 process (issue + rationale + same-PR
   update to §4).
8. **Bypass `sanitize()` when persisting LLM/user text.** Reserved
   markers, pipe chars, leading `#`, and length must always be filtered.
   See `lib/records.mjs:50-71`.
9. **Ship a `lib/` file without updating `package.json`'s `files` array
   AND `release.yml`'s `required` array.** The publish job will fail
   the tarball check, but only after you've cut the tag.
10. **Bump version without a `CHANGELOG.md` entry.** `release.yml`
    extracts release notes from the changelog (`release.yml:84-92`). No
    section ⇒ empty release notes ⇒ confused users.
11. **Edit `work-log.md` between the `WEEKLY_ENTRIES_*` markers.** Anything
    inside is rewritten on next `generate_work_log`. Anything outside is
    preserved. Touching the markers themselves breaks the next render.
12. **Add a runtime dependency.** Yes, this is listed twice. That's how
    important it is.

---

## 11. Where to find more

- [`README.md`](README.md) — user pitch, install, examples, FAQ. Match its voice.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — human contributor guide; some overlap with this doc.
- [`ROADMAP.md`](ROADMAP.md) — prioritized backlog. **Read before proposing new work.**
- [`CHANGELOG.md`](CHANGELOG.md) — per-version notes. Reflects what shipped, why, and which bugs each release fixed.
- [`SECURITY.md`](SECURITY.md) — Microsoft's standard responsible-disclosure pointer.
- [`docs/testing-strategy.md`](docs/testing-strategy.md) — current coverage + plan to add mock-host hooks tests and subprocess nightly E2E.
- [`docs/security-model.md`](docs/security-model.md) — threat model, data flow, redaction plan.
- [`docs/cross-engine-spec.md`](docs/cross-engine-spec.md) — MCP + Claude Code plugin design.
- [`docs/backfill-guide.md`](docs/backfill-guide.md) — user-facing how-to for back-filling history.
- [`skills/brag-sheet/SKILL.md`](skills/brag-sheet/SKILL.md) — the LLM-facing prompt, also mirrored in awesome-copilot.

---

## 12. Quick task playbook

Five-step recipes. Pick the one that matches your task; deviate only with reason.

### How to fix a bug

1. Reproduce it. Add a failing test in the matching `test/<module>.test.mjs`
   first. Confirm it fails: `node --test test/<module>.test.mjs`.
2. Find the offending function via `grep` / `lsp` (`workspaceSymbol`).
   Bug fixes almost always live inside one `lib/*` module.
3. Fix it. Keep the change surgical — don't drag in unrelated cleanups.
4. Run the full suite (`npm test`) — must stay 107+/0 across the matrix.
5. PR with a `CHANGELOG.md` entry under `## [Unreleased]` → `### Fixed`.
   Reference the issue. CI must be green before merge.

### How to add a feature

1. Check [`ROADMAP.md`](ROADMAP.md). If it isn't there, open an issue
   first to confirm priority — we are aggressive about saying no.
2. Decide the layer:
   - **New tool / hook behavior** → `extension.mjs` + a new function in
     the relevant `lib/*` module. Tests in
     `test/extension.test.mjs` for the helper logic.
   - **New record field** → `lib/records.mjs` (factory) + read-time
     compatibility in `lib/storage.mjs` + a render path in
     `lib/render.mjs`. **Old records must still read.** See §10 #4.
   - **New CLI / install behavior** → `bin/setup.mjs` or
     `install.{sh,ps1}` + matching CI smoke step in `ci.yml`.
3. Add tests *first* (TDD-friendly here — the suite is fast). Mirror the
   source filename. Use `mkdtempSync` for isolation.
4. Update [`README.md`](README.md) only if the feature is user-visible
   and shipping. Match the existing voice.
5. PR with `## [Unreleased]` → `### Added` entry in `CHANGELOG.md` and a
   ROADMAP item ticked or removed. Don't bump `version` in the same PR
   as a feature — that's a separate release PR.

### How to ship a release

1. From `main`, open a PR titled `release: vX.Y.Z`. In that PR:
   - Bump `package.json.version`.
   - Move `## [Unreleased]` → `## [X.Y.Z] — YYYY-MM-DD` in `CHANGELOG.md`.
   - Add a fresh empty `## [Unreleased]` heading.
2. Merge the PR (squash). Wait for CI green on `main`.
3. From up-to-date `main`: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. Watch `release.yml`. It validates tag/version match, validates the
   tarball, extracts changelog notes, creates the GitHub Release, and
   `npm publish --provenance`s.
5. Verify <https://www.npmjs.com/package/copilot-brag-sheet> shows the
   new version and `npm i -g copilot-brag-sheet@latest` works in a
   scratch shell.

### How to add a new lib module

1. Create `lib/<name>.mjs` — pure Node, dependency-free, `node:`-prefixed
   imports, `export`ed functions only.
2. Create `test/<name>.test.mjs` mirroring it.
3. Add the file to `package.json`'s `files` array.
4. Add the file to `.github/workflows/release.yml`'s `required` array
   (the publish-time tarball check). Both are required or the next
   publish silently ships a broken package.
5. Wire it into `extension.mjs` only if the host needs it; otherwise
   it's a shared utility consumed by hooks/tools.

### How to investigate a user-reported install failure

1. Reproduce on the same OS/shell. The CI matrix covers ubuntu/macos +
   Windows on PS 5.1 *and* pwsh 7+ — start by running the matching
   `install-smoke-*` job locally:
   ```powershell
   $env:COPILOT_HOME = "$env:TEMP\copilot-home-test"
   .\install.ps1   # or bash ./install.sh on *nix
   ```
2. Check `~/.copilot/extensions/copilot-brag-sheet/` for the expected
   layout (matches `release.yml:46-55`).
3. Repro under `BRAG_SHEET_DEBUG=1` and read the stderr trail.
4. If it's a host-side issue, link [github/copilot-cli#3023](https://github.com/github/copilot-cli/issues/3023)
   and any related upstream tracker.
5. Fix in `install.{sh,ps1}` or `bin/install.mjs` *and* extend the
   `install-smoke-*` matrix to prevent regression. (See `ci.yml:67-126`
   for the PS 5.1 + pwsh 7 split — that pattern caught the v1.0.1 bug.)

---

## 13. When to update this file

Add an entry here when **any** of these is true:

1. **An agent made the same mistake twice** — the rule prevents
   recurrence (e.g. §10.1 "no runtime deps without process" exists
   because adding one without updating §4 created a doc/code split).
2. **A code review or release-job caught something an agent should
   have known** — e.g. §10.9 "files array + release.yml required
   array" entered after a publish failure.
3. **You re-typed the same correction you typed last session** — that
   is the load-bearing signal that the file is too thin.
4. **A new teammate (human or AI) would need this context to ship
   safely** — onboarding-grade facts belong in §1, §2, or §9.

**Process rule for §4 "non-negotiable" changes:** if a PR breaks a §4
convention, the same PR must update §4 to reflect the new contract.
Splitting the code change and the doc change into separate PRs leaves
agents reading stale rules and "fixing" the new code out from under
itself. This rule exists because the v1.0.4 MCP SDK adoption initially
shipped without flipping the §4 "zero runtime dependencies" line.

Conversely, **delete** entries when:

- The "never" no longer applies (e.g. a dep we used to forbid is now
  approved with a written exception).
- The rationale is now obvious from the code (don't restate type
  signatures the agent can read).
- The fact is more accurately captured in a sibling doc
  (`docs/security-model.md`, `CHANGELOG.md`, etc.) — link to it
  instead.

Companion file: `skills/brag-sheet/SKILL.md` is the **portable
prompt** that ships in `awesome-copilot` and runs against any user's
repo. This file (`AGENTS.md`) is **facts about this repo for any
agent**. Keep that split clear when deciding which one a new note
belongs in.

---

## 14. Voice and tone for public-facing text

This repository is part of the Microsoft open-source program. All
text that ships in the repo or to a registry — README, CHANGELOG, PR
descriptions, commit messages, code comments, files under `docs/`,
`skills/brag-sheet/SKILL.md`, marketplace submissions — must read as
considered, neutral, professional engineering writing.

**Do:**

- Write conventions and rules as our own. The repo speaks with one
  voice; that voice is "Microsoft engineering doc."
- Cite primary sources only when needed for technical correctness —
  RFCs, official protocol specifications, the language standard, the
  Node API docs.
- Reference our own prior work (issues, PRs, CHANGELOG entries) by
  number when context helps.
- Use declarative sentences. Prefer "this file does X" over "here we
  attempt to do X."

**Do not:**

- Cite specific external developers, blog posts, or community
  projects as inspiration ("inspired by X", "after reading Y", "h/t
  Z", "borrowed from", "shamelessly stole from"). If a pattern is
  worth adopting, adopt it; the source belongs in your private
  engineering notes, not in the repo.
- Compare or evaluate competing products. Statements like "X is
  better than Y" or "Y was a mess" do not belong in this repo, even
  in commit messages.
- Use casual, ironic, or self-deprecating voice ("we copy-pasted
  this", "honestly we just guessed", "lol it works"). It reads as
  unprofessional in a Microsoft-org repo and is impossible to undo
  once it lands in git history.
- Insert personal opinions disguised as commentary in code comments.
  Code comments explain *what the code does and why*, not *how the
  author feels about a third party*.

**Legitimate technical references — these are fine:**

- "Implements the Model Context Protocol over stdio" (technical fact)
- "Compatible with GitHub Copilot CLI, Claude Code, and other MCP
  clients" (interop fact)
- "Per RFC 8259 §6, JSON numbers …" (spec citation for correctness)
- A link to a primary source in a code comment when the source is
  needed to understand a non-obvious behaviour (e.g. a Windows API
  edge case)

When in doubt: ask "would I want this sentence read aloud at a
customer review?" If no, take it out.

Private engineering notes (your scratchpad of "we got this idea
from X blog post") belong outside the repo. A typical home is
`~/Documents/brag-sheet-private-notes/` or your usual personal
notes location.

---

_Last updated: 2026-05. Keep this file living. If you discover a
convention not listed here, add it. If a "never" doesn't apply anymore,
delete it with explanation in the PR._

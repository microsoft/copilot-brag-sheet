# copilot-brag-sheet — Agent Handoff

> **Status**: Phases 0–5 complete. Extension, docs, and CI done. Phase 6 (final review) in progress.

---

## What This Is

A zero-dependency Copilot CLI extension that auto-logs coding sessions into structured JSON records,
with on-demand markdown rendering. Cross-platform (Windows/macOS/Linux), Node 18+.

**Published at**: `github.com/vidhartbhatia/copilot-brag-sheet`

---

## Current State

### ✅ Done (Phases 0–5)

| File | Status |
|------|--------|
| `package.json` | ✅ |
| `lib/paths.mjs` | ✅ tested |
| `lib/config.mjs` | ✅ tested |
| `lib/lock.mjs` | ✅ tested |
| `lib/storage.mjs` | ✅ tested |
| `lib/records.mjs` | ✅ tested |
| `lib/render.mjs` | ✅ tested |
| `extension.mjs` | ✅ tested |
| `lib/git-backup.mjs` | ✅ tested |
| `test/*.test.mjs` | ✅ 107/107 passing |
| `README.md` | ✅ |
| `CONTRIBUTING.md` | ✅ |
| `CHANGELOG.md` | ✅ |
| `ROADMAP.md` | ✅ |

Verify with: `npm test`

### ❌ Not Started

- Cross-model review + force-push publish — Phase 6

---

## Phase 3: extension.mjs — What to Build

This is the Copilot CLI entrypoint. It must:

### Imports
```js
import { detectDataDir, detectBragSheetPath, detectGitConfig, ensureDir } from './lib/paths.mjs';
import { loadConfig, getAllCategoryIds, isValidCategory, buildUserContext } from './lib/config.mjs';
import { writeRecord, readRecords, updateRecord, logError } from './lib/storage.mjs';
import { backupToGit, ensureGitRepo, addRemote } from './lib/git-backup.mjs';
import { createSessionRecord, createEntryRecord, addFileToRecord, sanitize, dedupeArray } from './lib/records.mjs';
import { renderMarkdown, renderReviewSummary } from './lib/render.mjs';
```

### Hooks (registered in joinSession callback)
- `onSessionStart(ctx)` — create session record, detect repo/branch, recover orphans
- `onUserPromptSubmitted(ctx)` — capture first prompt as `taskDescription`, detect "brag" keyword
- `onPostToolUse(ctx)` — track files edited/created, PRs created, git actions → incremental `updateRecord`
- `onSessionEnd(ctx)` — finalize session record (`status: "finalized"`)

### Event (NOT a hook — use `session.on(...)`)
- `session.on("session.shutdown", handler)` — emergency save (`status: "emergency-saved"`)

### Tools
- `save_to_brag_sheet` — validate → `createEntryRecord` → `writeRecord`
- `review_brag_sheet` — `readRecords(dateRange)` → `renderMarkdown` → return as text
- `generate_work_log` — `readRecords(all)` → `renderMarkdown` → atomic write to file

### Tool fields
- `save_to_brag_sheet`: `summary` (required), `category` (optional), `impact` (optional), `tags` (optional), `repo` (auto-detected), `branch` (auto-detected)
- `review_brag_sheet`: `weeks` (default 4)
- `generate_work_log`: `outputPath` (optional, defaults to data dir)
- All tools: `skipPermission: false`

### Orphan Recovery (in onSessionStart)
Scan active sessions > 5 min old with dead PIDs → mark as `status: "orphaned"`

### "brag" keyword detection (in onUserPromptSubmitted)
If prompt contains "brag", surface a reminder to call `save_to_brag_sheet`.

### File tracking (in onPostToolUse)
Look at `ctx.toolName` + `ctx.toolArgs`:
- File edits/creates: tool names like `create_file`, `edit_file`, `str_replace_editor`, etc.
- PR creation: tool result contains PR URL/number
- Git actions: commit/push tool calls → add to `significantActions`

Write incrementally to session record after each hook call (crash-safe).

---

## Session State Machine

```
active → finalized        (normal: onSessionEnd)
active → emergency-saved  (session.shutdown event)
active → orphaned         (next session: stale >5min + dead PID)
```

---

## Key Technical Decisions (DO NOT change these)

| Decision | Rationale |
|----------|-----------|
| No SQLite | Node 18 incompatible |
| No YAML | Would require parser dep |
| JSON records only | Zero deps, cloud-sync safe |
| Atomic writes (tmp→fsync→rename) | Crash-safe, OneDrive/iCloud safe |
| OS-native app data dirs | Cross-platform, not Microsoft-specific |
| Markdown is generated output only | Banner: "Generated — edits may be overwritten" |
| `WORK_TRACKER_DIR` env override | Lets users point to OneDrive/Dropbox etc. |
| No auto-regenerate markdown | On-demand only |

---

## Storage Layout

```
<data-dir>/
├── sessions/YYYY/MM/<timestamp>_<id>.json
├── entries/YYYY/MM/<timestamp>_<id>.json
├── config.json   (optional — zero-config is fine)
└── errors.log
```

Default data dirs:
- Windows: `%LOCALAPPDATA%\copilot-brag-sheet\`
- macOS: `~/Library/Application Support/copilot-brag-sheet/`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/copilot-brag-sheet/`

---

## Record Schemas

### Session Record
```json
{
  "id": "uuid",
  "type": "session",
  "source": "copilot-cli",
  "timestamp": "ISO-8601",
  "endTime": "ISO-8601",
  "repo": "repo-name-or-null",
  "repoFull": "org/repo-or-null",
  "branch": "branch-or-null",
  "cwd": "/absolute/path",
  "filesEdited": ["src/foo.ts"],
  "filesCreated": [],
  "prsCreated": [{"id": 123, "title": "fix: thing", "repo": "repo-name"}],
  "significantActions": ["git commit", "git push"],
  "summary": "what was accomplished",
  "taskDescription": "first user prompt text",
  "category": null,
  "tags": [],
  "impact": null,
  "status": "finalized",
  "pid": 12345
}
```

### Manual Entry Record
```json
{
  "id": "uuid",
  "type": "entry",
  "source": "manual",
  "timestamp": "ISO-8601",
  "summary": "...",
  "category": "infrastructure",
  "tags": ["dashboard", "migration"],
  "impact": "...",
  "repo": "repo-name",
  "branch": "main",
  "sessionId": "linked-session-uuid"
}
```

---

## Categories (DO NOT add/remove — match records.mjs)

```
pr 🚀 | bugfix 🐛 | infrastructure 🏗️ | investigation 🔍
collaboration 🤝 | tooling 🔧 | oncall 🚨 | design 📐 | documentation 📝
```

Custom categories allowed via config.json.

---

## Path Rules (for onPostToolUse file tracking)

- `repo`, `repoFull`, `branch` = null when outside git repo
- File paths: repo-relative when inside git, absolute otherwise
- Skip `.copilot/session-state/` paths entirely
- Normalize all paths via `path.resolve()`

---

## render.mjs Markers (don't break these)

```
<!-- WEEKLY_ENTRIES_START — do not remove this marker -->
<!-- WEEKLY_ENTRIES_END — do not remove this marker -->
```

---

## Remaining Work

1. Phase 6: cross-model review (GPT for code, Opus for docs), then force-push to GitHub as clean v1.0

---

## Publishing Notes

- Personal GitHub release under MIT license ✅
- Force-push to `github.com/vidhartbhatia/copilot-brag-sheet` (v1 had 0 users, safe to reset)
- Tag as `v1.0.0` after publish

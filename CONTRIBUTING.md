# Contributing to Copilot Brag Sheet

Thanks for your interest in contributing! This project is designed to be simple, zero-dependency, and easy to hack on.

## Development Setup

```bash
git clone https://github.com/vidhartbhatia/copilot-brag-sheet.git
cd copilot-brag-sheet
npm test
```

No `npm install` needed — zero dependencies.

## Project Structure

```
extension.mjs        ← Copilot CLI entry point (hooks + tools)
lib/
  paths.mjs          ← Data directory detection, path helpers
  config.mjs         ← Config loading and category management
  lock.mjs           ← File locking for concurrent access
  storage.mjs        ← Atomic JSON read/write, record CRUD
  records.mjs        ← Record creation, sanitization, file tracking
  render.mjs         ← Markdown rendering
  git-backup.mjs     ← Git version history and remote sync
bin/
  setup.mjs          ← Interactive setup wizard
install.sh           ← macOS/Linux installer
install.ps1          ← Windows installer
plugin.json          ← Copilot CLI plugin manifest
test/
  *.test.mjs         ← Tests using Node.js built-in test runner
```

## Running Tests

```bash
npm test                           # All tests
node --test test/storage.test.mjs  # Single file
```

Tests use Node.js built-in `node:test` — no test framework dependency needed.

## Key Design Decisions

These are intentional constraints — please don't change them without discussion:

| Decision | Rationale |
|----------|-----------|
| Zero dependencies | Runs anywhere Node 18+ exists |
| No SQLite | Node 18 built-in SQLite is not available |
| JSON records only | Cloud-sync safe, human-readable |
| Atomic writes (tmp→fsync→rename) | Crash-safe, OneDrive/iCloud safe |
| OS-native app-data dirs | Cross-platform, follows OS conventions |
| Markdown is generated output only | Source of truth is JSON |

## Code Style

- ES modules (`.mjs`) throughout
- No transpilation — runs directly on Node.js
- Prefer `node:` prefixed imports (`node:fs`, `node:path`)
- No `console.log()` in extension code (stdout is JSON-RPC)
- Use `session.log()` for user-facing messages
- Wrap all hook/tool handlers in try-catch

## Adding a New Tool

1. Define the tool in `extension.mjs` in the `tools` array
2. Follow the existing pattern: name, description, parameters (JSON Schema), handler
3. Use `ensureInitialized()` at the start of the handler for resilience
4. Return a string on success, `{ textResultForLlm, resultType: "failure" }` on error
5. Add tests in `test/extension.test.mjs`

## Pull Requests

- Keep changes focused — one feature or fix per PR
- All tests must pass (`npm test`)
- Update CHANGELOG.md for user-visible changes
- No new runtime dependencies

## Reporting Issues

Open an issue with:
- Node.js version (`node --version`)
- OS and version
- Steps to reproduce
- Expected vs actual behavior

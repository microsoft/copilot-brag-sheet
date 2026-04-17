# Contributing to Copilot Brag Sheet

This project welcomes contributions and suggestions. Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit <https://cla.opensource.microsoft.com>.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Development Setup

```bash
git clone https://github.com/microsoft/copilot-brag-sheet.git
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

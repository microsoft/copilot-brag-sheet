# Testing Strategy

> Companion doc to [`AGENTS.md`](../AGENTS.md). This is the canonical place
> to look for what we test, what we don't, and how the gaps will close.

---

## Current state — 2026-05

**107 tests, 100% pass rate, 14 suites, ~750ms total runtime.**
CI matrix: `{ubuntu-latest, macos-latest, windows-latest} × {Node 18, 20, 22}` =
**9 combinations** running on every PR and `main` push, plus three
**install-smoke** jobs that exercise the curl-pipe-bash installers
(Linux/macOS, Windows PS 5.1, Windows pwsh 7+).

Run the suite locally:

```bash
npm test                                      # all 107
node --test test/storage.test.mjs             # one file
node --test --test-name-pattern="atomic"      # one pattern
```

PowerShell-friendly variants (Windows):

```powershell
npm test
node --test test\storage.test.mjs
node --test --test-name-pattern="atomic" test\storage.test.mjs
```

No test framework dependency — we use `node:test` and
`node:assert/strict`. Adding `mocha` / `vitest` / `jest` is a hard no
(see [`AGENTS.md` §10 — Things to NEVER do](../AGENTS.md#10-things-to-never-do)).

---

## Coverage map by module

| Source module | Test file | Tests | What is covered | What is NOT covered |
|---|---|---:|---|---|
| [`lib/paths.mjs`](../lib/paths.mjs) | `test/paths.test.mjs` | 7 | Per-platform data dir resolution (Win/macOS/Linux), env-var overrides (`WORK_TRACKER_DIR`, `XDG_DATA_HOME`, `LOCALAPPDATA`, `WORK_TRACKER_OUTPUT_PATH`), `ensureDir` idempotency. | Symlinked HOME directories. UNC paths on Windows (tracked in [ROADMAP P4](../ROADMAP.md)). |
| [`lib/config.mjs`](../lib/config.mjs) | `test/config.test.mjs` | 9 | Default config shape, deep-merge with user config, microsoft preset toggles, missing-file fallback, malformed-JSON fallback, category lookup helpers, `buildUserContext` for preset. | Malicious config that injects `__proto__` keys. Unknown preset names (currently silently ignored). |
| [`lib/lock.mjs`](../lib/lock.mjs) | `test/lock.test.mjs` | 7 | Successful acquire/release, contention (`EEXIST` retries), stale-PID detection (`process.kill(pid, 0)`), lock-file content readback, timeout. | Multi-process contention (we mock PIDs). Filesystem-level locking on network shares (SMB/NFS). |
| [`lib/storage.mjs`](../lib/storage.mjs) | `test/storage.test.mjs` | 10 | Atomic write (tmp file cleanup on failure), shard layout (`YYYY/MM/<ts>_<id>.json`), shard-bound filtering on `since`/`until`, type/category/repo/tags filters, `updateRecord` merge semantics, `logError` never throws. | Disk-full scenarios. `fsync` failures (we trust the OS). Records with `Date.parse`-invalid timestamps in old data. |
| [`lib/records.mjs`](../lib/records.mjs) | `test/records.test.mjs` | 8 | `createSessionRecord` + `createEntryRecord` shape, `sanitize()` (newlines, markers, headings, pipes, length cap), `addFileToRecord` dedup + `.copilot/session-state` filtering + repo-relative path normalization. | Case-insensitive dedup on Windows/macOS. Path traversal (`../`) attempts. |
| [`lib/render.mjs`](../lib/render.mjs) | `test/render.test.mjs` | 14 | `weekOf` UTC consistency including year boundaries, `renderMarkdown` empty/single/multi-week/multi-category cases, session-log opt-in, escaping pipes in tables, ordering newest-first, "Other" bucket for uncategorized, `renderReviewSummary` window filtering. | Internationalized week boundaries (we hardcode UTC). Locale-specific month names. |
| [`lib/git-backup.mjs`](../lib/git-backup.mjs) | `test/git-backup.test.mjs` | 18 | `ensureGitRepo` init + idempotent reuse, `addRemote`, `hasRemote`, `backupToGit` happy path / no-changes / commit-fail / push-fail, error logging via the injectable runner pattern (`createGitRunner`). | Real `git` binary execution (we mock). Auth failures on push. Detached HEAD states. Repos with submodules. |
| [`extension.mjs`](../extension.mjs) | `test/extension.test.mjs` | 34 | Pure helpers extracted from the entry point: session lifecycle (active/finalized/orphaned/emergency-saved), file tracking (edit/create classification, dedup, `.copilot/session-state` skip, repo-relative normalization), significant-action accumulation, `save_to_brag_sheet` flow, category validation, summary sanitization, repo/branch auto-detection, `review_brag_sheet` rendering, `generate_work_log` write, **`brag` keyword regex** (must match standalone, exclude `bragging`/`braggart`), PR info extraction, shell-command git-action detection. | Hooks firing inside the SDK runtime (see "What is NOT covered" below). |
| [`bin/setup.mjs`](../bin/setup.mjs) | — | 0 | — | Interactive prompts. Non-TTY exit (covered indirectly by CI matrix). |
| [`bin/install.mjs`](../bin/install.mjs) | install-smoke (CI) | 0 unit | Tarball → `~/.copilot/extensions/...` layout. Re-run idempotency. | Failure path when `COPILOT_HOME` exists but isn't writable. |
| [`install.sh`](../install.sh) / [`install.ps1`](../install.ps1) | install-smoke (CI) | — | End-to-end install on Linux/macOS, Windows PS 5.1, Windows pwsh 7+ (matches real-world Windows 10/11 default shell). | Air-gapped installs. Behind-corporate-proxy installs. |

**Total: 107 unit tests + 4 install-smoke jobs (3 OS × shells).**

---

## Why some things are intentionally NOT unit-tested

### `extension.mjs` hooks

The entry point starts with:

```js
import { joinSession } from "@github/copilot-sdk/extension";
// ...
const session = await joinSession({ hooks: {...}, tools: [...] });
```

That import only resolves inside a real Copilot CLI host process — the
SDK is injected at load time, not installed via npm (it's a peer dep
declared `optional`). Any test that does
`import "../extension.mjs"` will throw `ERR_MODULE_NOT_FOUND` outside
the host.

We work around that by extracting every pure helper from `extension.mjs`
and re-implementing it (or testing the underlying `lib/*` it delegates
to). That's why `test/extension.test.mjs` lives next to the entry point
but doesn't actually import it.

The trade-off: **the wiring between hooks and lib functions is currently
verified only by manual smoke tests.** That's the largest gap in our
coverage.

### `bin/setup.mjs`

Interactive `readline` prompts are hard to test cleanly in `node:test`
without dragging in an interactive-CLI testing library (which would
violate zero deps). The non-TTY path *is* exercised every time CI
install-smoke runs without a real terminal — if it ever regresses, that
job fails, which is exactly what happened before v1.0.3 (`CHANGELOG.md`
entry "bin/setup.mjs non-TTY hang").

### Real `git` execution

`test/git-backup.test.mjs` injects a fake runner via the `createGitRunner`
hook pattern (`lib/git-backup.mjs:34-46`). Running real `git` in tests
would:

- couple us to whatever git version the runner has installed,
- require a writable HOME with valid `user.email` / `user.name`,
- introduce flake from clock skew on commit messages.

The mocked path verifies our argv composition, exit-code handling, and
error logging — which is what we own. The actual git binary is
upstream's responsibility.

---

## Roadmap to better coverage

These are tracked informally; promote to `ROADMAP.md` if you start work.

### 1. Mock-host hooks tests (high value, medium effort)

**Goal:** verify that `onSessionStart` writes a session record,
`onPostToolUse` for an `edit` tool appends to `filesEdited`, etc., end-to-end.

**Approach:** ship a tiny `test/_mock-host.mjs` that exposes a fake
`joinSession` shim, then point a test-only build of `extension.mjs` at
it via an environment-gated import. Sketch:

```js
// test/_mock-host.mjs
export async function joinSession({ hooks, tools }) {
  return {
    log: async () => {},
    on: () => {},
    __hooks: hooks,
    __tools: tools,
  };
}

// test/extension-hooks.test.mjs
process.env.WORK_TRACKER_DIR = mkdtempSync(...);
process.env.BRAG_SHEET_TEST_HOST = "1";
const ext = await import("../extension.mjs"); // import-mapped to mock
await ext.__hooks.onSessionStart({ cwd: "/tmp" }, { sessionId: "t1" });
const records = readRecords(process.env.WORK_TRACKER_DIR);
assert.equal(records.length, 1);
```

The import-map can use `node --conditions=test` + a `package.json`
exports map, or a tiny build step that rewrites the SDK import.

### 2. Subprocess nightly E2E (high value, high effort)

**Goal:** spawn `node extension.mjs` as a child process, drive it
through the JSON-RPC stdio protocol, assert it produces the right
records on disk and the right responses on stdout.

**Why nightly, not per-PR:** cold-start time dominates and these tests
need a published `@github/copilot-sdk` to actually load. They are also
the most likely to flake on CI runners with slow disk I/O.

**Trigger:** add `.github/workflows/e2e-nightly.yml` running on a cron,
not on PRs. Failures open an issue rather than blocking merge.

### 3. Cross-platform path edge cases (medium value, low effort)

- Case-insensitive dedup on Windows/macOS HFS+ (`C:\Foo\bar.js` ===
  `c:\foo\BAR.js`).
- UNC paths on Windows (`\\server\share\file.js`).
- Symlinked repos (resolve real path before storing).

### 4. Property-based tests for sanitize()

`sanitize` is the only place LLM output meets disk. Use a small in-house
fuzzer (no dependency) that throws random strings at it and asserts:

- output never contains `WEEKLY_ENTRIES_START` / `WEEKLY_ENTRIES_END`,
- output ≤ 500 chars,
- output has no unescaped pipes,
- round-tripping through `sanitize` is a fixpoint.

### 5. Schema migration test scaffold

When (not if) we add a record field, we need to assert that records
written by an older version still parse. A `test/fixtures/legacy/` dir
of hand-crafted v1.0.x records, fed through `readRecords`, would catch
schema drift before users do.

---

## Test-writing conventions

- **Mirror filenames.** `lib/foo.mjs` → `test/foo.test.mjs`.
- **Use `node:test`.** `describe` / `it` / `before` / `after` only.
  No `t.test` (callback) style — it's harder to read.
- **Use `mkdtempSync(join(tmpdir(), "..."))`** for any test that
  touches disk. Clean up in `after()` with
  `rmSync(dir, { recursive: true, force: true })`.
- **No `process.chdir`** — it's not safe in parallel runners.
- **Make external commands injectable.** Follow `createGitRunner` in
  `lib/git-backup.mjs` — take an optional function param so the test
  can pass a stub.
- **Assertions:** prefer `assert.deepEqual` / `assert.equal` over field-by-
  field. Compare entire objects rather than enumerating one field at a time.
- **One scenario per `it()`.** A test that checks five things should
  probably be five tests.
- **Keep tests fast.** Total suite runs in ~750ms today. If a single
  test takes >100ms, ask why.

---

## Pre-flight checklist for any PR that changes test behavior

- [ ] `npm test` passes locally.
- [ ] New tests follow the mirror-filename convention.
- [ ] Disk-touching tests use `mkdtemp` + `after` cleanup.
- [ ] No new dependencies (devDependencies included).
- [ ] If the suite count changed, the headline number in
      [`AGENTS.md` §5](../AGENTS.md#5-testing-strategy) and this
      doc's "Current state" section have been updated.
- [ ] If a new `lib/` module was added, it has a matching
      `test/<name>.test.mjs` with at least three tests covering
      happy-path, error path, and an edge case.

---

## Related reading

- [`AGENTS.md`](../AGENTS.md) — top-level agent guide. §5 (testing) and
  §10 (things to never do) are most relevant here.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — human contributor guide;
  overlaps with the conventions section.
- [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — the
  authoritative source for what CI runs.

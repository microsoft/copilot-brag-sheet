# Security Model

> Companion doc to [`AGENTS.md`](../AGENTS.md). Read this whenever you're
> about to add a new I/O surface, change what's persisted, or wire in
> network egress. For Microsoft's responsible-disclosure pointer, see
> [`SECURITY.md`](../SECURITY.md).

---

## TL;DR

`copilot-brag-sheet` is a **local-first, zero-telemetry, zero-network**
extension. The only data that ever leaves the user's machine is the
optional `git push` they explicitly opt into during setup, to a remote
they themselves chose. Records on disk are written atomically; concurrent
writers are serialized via PID-aware file locks; LLM output is sanitized
before persistence.

What we do **NOT** defend against today (and you should know about):
secret leakage from prompts/LLM output (redaction is on the roadmap),
filesystem snooping by other local users on the same machine, and
malicious co-resident extensions inside the Copilot CLI process. We
inherit the host's trust model.

---

## Threat model

We use a deliberately small STRIDE-lite framing.

| Threat | In scope? | Mitigation |
|---|---|---|
| **Spoofing** the data dir (env-var injection) | ✅ | `WORK_TRACKER_DIR` is honored as the user explicitly opts into it via setup. We document this. The wizard is gated on `process.stdin.isTTY` — non-interactive callers must hand-edit `config.json`. |
| **Tampering** with records mid-write | ✅ | Atomic writes (`tmp → fsync → rename`). On crash you keep either the previous version or the complete new one — never half. See [`lib/storage.mjs:216-244`](../lib/storage.mjs). |
| **Repudiation** of brag entries | ❌ out of scope | This is a personal log, not an audit log. Don't use it where authenticity matters. |
| **Information disclosure** to network | ✅ | No outbound HTTP. The only network call is `git push`, only when both `gitConfig.enabled` AND `gitConfig.push` are true AND a remote exists ([`lib/git-backup.mjs:151-164`](../lib/git-backup.mjs)). |
| **Information disclosure** to disk (secrets in records) | 🟡 partial | `sanitize()` strips structure but does **not** redact secrets. See "Known gaps" below. |
| **Information disclosure** to other local users | 🟡 partial | Records inherit OS default file permissions on the data dir. We do not `chmod 600`. Single-user laptops are fine; shared boxes aren't. |
| **Denial of service** (lockfile starvation) | ✅ | `withFileLock` has a 5s default timeout and stale-PID cleanup ([`lib/lock.mjs:94-130`](../lib/lock.mjs)). A dead process can't hold a lock forever. |
| **Elevation of privilege** | ❌ | The extension runs as the user. There is no privileged code path. |
| **Supply-chain attack on `@github/copilot-sdk`** | ❌ inherited | Declared as `peerDependencies.optional`. We trust whatever the host injects. |
| **Supply-chain attack on this package on npm** | ✅ | Releases are tag-triggered + provenance-signed (`npm publish --provenance`). `_npmUser` ↔ `author: Microsoft` chain-of-trust gap is tracked under [ROADMAP P2 — Trusted Publishing migration](../ROADMAP.md). |

---

## Data flow

```
┌─────────────────┐      stdin/stdout         ┌──────────────────────┐
│  Copilot CLI    │ ◀───────JSON-RPC────────▶ │   extension.mjs      │
│  host process   │                           │   (joinSession)      │
└─────────────────┘                           └──────────┬───────────┘
                                                         │
                            tool args / hook input       │
                                                         ▼
                                              ┌──────────────────────┐
                                              │   sanitize()         │  ← lib/records.mjs
                                              │   (strip markers,    │
                                              │    pipes, headings,  │
                                              │    cap 500 chars)    │
                                              └──────────┬───────────┘
                                                         │
                                                  validated record
                                                         │
                                                         ▼
                                              ┌──────────────────────┐
                                              │   atomicWriteJSON    │  ← lib/storage.mjs
                                              │   (tmp + fsync +     │
                                              │    rename)           │
                                              └──────────┬───────────┘
                                                         │
                                                         ▼
                                              ┌──────────────────────┐
                                              │  <dataDir>/          │
                                              │   sessions/YYYY/MM/  │
                                              │   entries/YYYY/MM/   │
                                              │   config.json        │
                                              │   work-log.md        │
                                              │   errors.log         │
                                              └──────────┬───────────┘
                                                         │
                                                         │ optional, opt-in
                                                         ▼
                                              ┌──────────────────────┐
                                              │  git commit / push   │  ← lib/git-backup.mjs
                                              │  (sessions/* git-    │
                                              │   ignored — only     │
                                              │   entries pushed)    │
                                              └──────────────────────┘
```

**Trust boundaries (numbered, smallest → largest blast radius):**

1. **LLM tool args → `sanitize()`** — never trust free-form text. Reserved markers, pipes, leading `#`, length all filtered.
2. **`sanitize()`'d data → atomic write** — content is now structurally safe; durability is now the OS's problem and we use `fsync`.
3. **Disk → optional git** — entries dir only; sessions are in `.gitignore` to prevent noise *and* to reduce the surface area of what gets pushed remotely (defense in depth even though sessions don't normally contain secrets).
4. **Git → user-chosen remote** — outside our trust boundary entirely. Users pick GitHub, ADO, self-hosted, whatever.

---

## What we DO defend against

### 1. Crash mid-write

All JSON writes go through `atomicWriteJSON`
([`lib/storage.mjs:216-244`](../lib/storage.mjs)):

```js
fd = openSync(tmpPath, "w");
writeFileSync(fd, JSON.stringify(data, null, 2));
fsyncSync(fd);
closeSync(fd);
renameSync(tmpPath, filePath);
```

`fsync` forces durability before the rename. `rename` is atomic on
POSIX and on Windows for same-volume moves. Failure cleans up the tmp
file. **Result:** OneDrive-, iCloud-, Dropbox-safe. The user never
loses an existing record because of a crash.

The same pattern is duplicated for text in
[`extension.mjs:118-135`](../extension.mjs) (`atomicWriteText`) so
`work-log.md` regeneration is also crash-safe.

### 2. Concurrent writers

Multiple Copilot CLI sessions can overlap on the same data dir.
`withFileLock` ([`lib/lock.mjs`](../lib/lock.mjs)) wraps every
`updateRecord`:

- `openSync(lockPath, "wx")` — atomic create, fails with `EEXIST` if held.
- PID written into the lockfile so a stale lock can be diagnosed.
- Stale detection: `process.kill(pid, 0)` returns truthy only if the
  process is alive (or `EPERM`). Dead PIDs ⇒ unlink and retry.
- 30s default stale window — long enough that a slow GC pause doesn't
  trip cleanup, short enough that a real crash doesn't wedge anyone.

### 3. Process death without graceful shutdown

Three layers:

- `session.shutdown` handler in [`extension.mjs:558-571`](../extension.mjs)
  uses **synchronous** `writeRecord` to mark the session
  `emergency-saved` even if the host kills us mid-stream.
- `recoverOrphans` on next session start
  ([`extension.mjs:94-116`](../extension.mjs)) marks any session that's
  still `active` but whose PID is dead and timestamp >5min old as
  `orphaned`. The user sees "I crashed" rather than a phantom open
  session forever.
- `try { logError(...) } catch {}` everywhere — see "Errors are logged,
  not thrown" in [`AGENTS.md` §4](../AGENTS.md#4-code-conventions).

### 4. Network egress

There is none, by construction. The only network code path is git push
in [`lib/git-backup.mjs:151-164`](../lib/git-backup.mjs), gated on
**three** independent conditions:

1. `gitConfig.enabled === true` (set during setup wizard)
2. `gitConfig.push === true` (set during setup wizard)
3. `hasRemote()` returns true (user added a remote)

All three are user-controlled. We never push to a default remote, never
auto-add a remote, never offer "send error reports" or any analytics.

### 5. Markdown injection

Without sanitization, an attacker (or a chatty LLM) could write
`WEEKLY_ENTRIES_END\n# Look at me` into a summary and corrupt the
`work-log.md` markers, hijacking the table layout or breaking the next
regeneration. `sanitize()` ([`lib/records.mjs:50-71`](../lib/records.mjs)):

- `\r?\n` → `' '` (no newlines in stored summaries).
- Strips both `WEEKLY_ENTRIES_START` and `WEEKLY_ENTRIES_END` markers.
- Strips leading `#` so an entry can't masquerade as a heading.
- Escapes `|` → `\|` so table rows render correctly in `renderMarkdown`.
- Trims and caps at 500 chars.

Tests cover these in [`test/records.test.mjs`](../test/records.test.mjs)
and [`test/render.test.mjs`](../test/render.test.mjs) (pipe escaping
end-to-end).

### 6. Path traversal in tracked file paths

`addFileToRecord` ([`lib/records.mjs:89-116`](../lib/records.mjs)):

- `path.resolve(filePath)` collapses `..` segments to an absolute path.
- If the resolved path falls inside the repo root, we store a
  forward-slash-normalized **relative** path. Otherwise we store the
  absolute path.
- Skips anything containing `.copilot/session-state` so the agent's own
  scratch space never ends up in the user's brag log.

This means an LLM can't trick us into recording
`../../../../etc/passwd` as a tracked file — it'll either become an
absolute path (visible to the user) or stay outside the repo (unstored
under repo-relative tracking).

---

## What we do NOT currently defend against

These are documented gaps. Don't be surprised by them; help close them.

### 1. Secret leakage in records

If a user types `My PR #42 used API_KEY=sk-abc123` into a prompt and the
LLM rolls that into `summary` for a `save_to_brag_sheet` call, we'll
write `sk-abc123` to disk in `entries/YYYY/MM/...json`. We do not
currently scan for token patterns.

**Mitigation today:** records are local-only by default; `entries/` is
included in optional git backup but `sessions/` is not. Even so, a
distracted user could push a private repo with secrets in it.

**Roadmap:** add a `redactSecrets()` pass between
`createEntryRecord` and `writeRecord`. Pattern source-of-truth should be
GitHub's own [secret-scanning regexes](https://docs.github.com/en/code-security/secret-scanning/secret-scanning-patterns)
where they're publicly documented. Targets to start with:

- GitHub PAT (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`)
- OpenAI / Anthropic API keys (`sk-...`, `sk-ant-...`)
- Azure connection strings (`DefaultEndpointsProtocol=...AccountKey=...`)
- AWS access keys (`AKIA[0-9A-Z]{16}` + secret pair)
- Generic `Bearer <jwt>` tokens

Replacement should be `<redacted:type>` so the record stays human-readable.

This is **not** ambitious secret detection (we won't beat GitGuardian).
It's defense in depth so a casual paste doesn't end up in a quarterly review.

### 2. Filesystem ACLs on the data dir

We `mkdirSync(dataDir, { recursive: true })` but don't set restrictive
permissions. On a typical single-user laptop this is fine. On a shared
box, another local user with read access to your home dir can read your
entries. We are not going to ship a macOS `chmod 700` because it would
fight users' existing setups, but the option is open if there's demand.

### 3. Co-resident hostile extensions

The Copilot CLI host runs all extensions in the same Node process. A
hostile extension running alongside us could read our memory, our
tool-call args, and our records. **We trust the host.** If you don't
trust the host, don't install anything in `~/.copilot/extensions/`.

### 4. Time-of-check / time-of-use on the lockfile

A determined attacker on the same machine could race us between
`cleanupStaleLock` (we observe the PID is dead) and `createLock` (we
re-create). The window is microseconds and the worst-case outcome is a
duplicate write that the receiving JSON write would clobber atomically
anyway. We accept this.

### 5. Repository-private branch in git backup

When git push is enabled, `backupToGit` does
`git pull --rebase` then `git push`. If the user configured a public
GitHub remote by mistake, their entries become public. We **strongly
recommend** a private repo in the setup wizard — but we do not check
remote visibility and cannot, since GitHub APIs aren't available without
a token we don't ask for.

---

## What goes in `errors.log`

`logError(dataDir, context, error)`
([`lib/storage.mjs:305-313`](../lib/storage.mjs)) appends:

```
[2026-05-01T12:34:56.789Z] <context>: <error.message>
```

It does **not** log:

- Stack traces (deliberately — too noisy, often leak paths).
- Tool arguments or prompt text.
- Record contents.

It uses `appendFileSync` (not atomic) because a corrupted error log is
strictly less bad than throwing out of `logError` itself. The function
swallows its own errors:

```js
} catch {
  // Never throw from logging.
}
```

If you're tempted to make this richer, file an issue first. The current
behavior is intentional.

---

## Privacy posture

- **Telemetry:** none. Ever. Adding any phone-home is in the §10
  "things to never do" list in [`AGENTS.md`](../AGENTS.md).
- **Update notifications:** none. The Node `update-notifier` package is
  a frequent silent telemetry vector AND breaks zero-deps; users update
  via `npm update -g`.
- **Crash reporting:** local-only via `errors.log`. We never upload it.
- **Analytics events:** none.
- **Default git backup:** OFF. Opt-in only.
- **Default git push:** OFF, even if backup is enabled. Two separate flags.

The README's `🚫 Zero telemetry` claim is load-bearing. Don't break it.

---

## Why `sessions/` is gitignored

When a user enables git backup, we generate `.gitignore` in the data
dir ([`lib/git-backup.mjs:6-16`](../lib/git-backup.mjs)) excluding:

```
sessions/
errors.log
*.lock
*.tmp.*
```

Two reasons:

1. **Volume.** A heavy Copilot user creates dozens of session records
   per day. A year of pushes would blow up the remote and rebase performance.
2. **Defense in depth on data exposure.** Session records contain
   tracked file paths, repo names, branch names, PRs created, *and the
   first prompt as `taskDescription`* (see
   [`extension.mjs:251-262`](../extension.mjs)). That first prompt is
   the most likely place a user would accidentally paste a secret.
   Keeping sessions local-only — even when backup is enabled — means
   that surface area never reaches a remote.

`entries/` is the curated, intentional brag-sheet content. Those
*should* sync, because that's the whole point of cross-machine backup.

---

## Reporting a vulnerability

Please **do not** open a public GitHub issue. Follow the disclosure
process documented in [`SECURITY.md`](../SECURITY.md), which routes
through Microsoft's MSRC.

For non-vulnerability security suggestions (e.g. "we should redact API
keys"), open a regular issue tagged `security` and link this doc.

---

## Related reading

- [`AGENTS.md`](../AGENTS.md) — agent-facing top-level guide. §6
  (security & privacy posture) summarizes this doc.
- [`SECURITY.md`](../SECURITY.md) — Microsoft responsible-disclosure pointer.
- [`docs/testing-strategy.md`](testing-strategy.md) — what's tested,
  including the security-relevant `sanitize`, `atomicWriteJSON`, and
  lockfile behaviors.
- [`lib/records.mjs`](../lib/records.mjs) — `sanitize()` and
  `addFileToRecord()` are the two main filtering functions.
- [`lib/storage.mjs`](../lib/storage.mjs) — atomic write + error logging.
- [`lib/git-backup.mjs`](../lib/git-backup.mjs) — the only network surface.
- [`ROADMAP.md`](../ROADMAP.md) — Trusted Publishing migration (P2),
  redaction (not yet listed; add when starting work).

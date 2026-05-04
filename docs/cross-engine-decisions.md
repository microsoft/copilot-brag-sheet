# Cross-Engine Spec — Decisions

> Companion to [`cross-engine-spec.md`](./cross-engine-spec.md). Records the
> resolution of the five open questions left at the bottom of that spec, so
> future readers know *why* the v1.1 scaffold looks the way it does.

**Decided:** 2025-05 (during MCP-server scaffold PR).
**Scope of this doc:** decisions only. The "Architecture" and "What's
Reusable" sections of the parent spec stand unchanged.

---

## 1. Zero-dep vs SDK → **use the official MCP SDK + Zod**

**Decision:** Build the MCP server on `@modelcontextprotocol/sdk` with
`zod` for input schemas. Declare both as runtime dependencies in
`package.json`. The brand surface flips from "zero dependencies" to
"MCP-conformant".

**Why:**

- Conformance beats independence. The SDK validates handshake versions,
  reserved JSON-RPC ids, capability negotiation, and content-type
  envelopes for free. Hand-rolling these would diverge from the spec
  every time the spec moves.
- Zod gives us strict input schemas (`.strict()` → JSON Schema
  `additionalProperties: false`), declarative `outputSchema` for every
  tool, and parse errors that surface as proper `-32602` results rather
  than ad-hoc strings. Both are required by the MCP protocol's reference
  implementation guidance the parent spec cites.
- Two deps is still a small surface. Both are widely audited, ship ESM,
  and pin to caret ranges. The original "zero dependency" goal protected
  install-time UX; with `npm install` already required for the extension,
  two transitive trees do not change the install story meaningfully.
- Enables the 10-question evaluation suite at `evals/` to run against the
  same wire surface real MCP hosts will use, with no protocol drift
  between local tests and downstream consumers.

**Cost:** Two runtime deps (`@modelcontextprotocol/sdk`, `zod`). Brand
copy in README / SKILL / plugin manifests had to flip. The tradeoff is
explicit: we accept dependencies in exchange for spec conformance and a
thinner server file.

**File:** [`mcp-server.mjs`](../mcp-server.mjs) at repo root, with the
matching evaluation suite at [`evals/`](../evals/).

---

## 2. Hook state persistence → **defer hooks entirely to v2**

**Decision:** The first cross-engine release ships **MCP only**. No
`hooks/`, no `hooks.json`, no `session-start.mjs` / `session-end.mjs`.

**Why:**

- MCP unblocks every host that doesn't speak Copilot's `joinSession()` —
  Claude Code, Codex CLI, Cursor, Agency — which is the actual user
  request.
- Hooks add real complexity (process boundaries, state passing, engine
  differences) for the *auto-tracking* feature, which is a nice-to-have
  layered on top of the core tools.
- A correctly designed hook story needs answers to question 3 (file
  tracking) that we don't have without prototyping inside Claude Code.
- Shipping MCP-only first lets us validate the lib/ surface across hosts
  before locking in a hook contract that has to work everywhere.

**Follow-up:** Track in [issue #22] under a separate "v2: hooks" milestone.
The Copilot-CLI auto-tracking continues to work via the existing
`extension.mjs` → `joinSession()` path; nothing regresses.

---

## 3. File tracking in Claude Code hooks → **deferred (with v2)**

**Decision:** Out of scope for this PR. See question 2.

**Why:** Claude Code's hook surface (`PreToolUse`, `PostToolUse`,
`SessionEnd`, etc.) does expose tool invocations including `Edit` and
`Write`, so the answer is almost certainly "yes, we can mirror what
`onPostToolUse` does today" — but the exact event shapes and how they
interact with subagents need a working prototype before we commit to a
contract. That prototype belongs in the v2 hooks PR, not here.

---

## 4. Backward compat for `extension.mjs` → **keep extension.mjs unchanged; new `bin` is additive**

**Decision:**

- `extension.mjs` is **not modified** by this PR. Existing Copilot CLI
  users see no behavioural change.
- `bin/install.mjs` and `bin/setup.mjs` are **not modified**. They keep
  installing the Copilot CLI extension exactly as before.
- The MCP server is exposed only via the new `bin` entry
  (`copilot-brag-sheet-mcp`). Hosts opt in by configuring it as an MCP
  server (e.g. `claude mcp add … -- npx copilot-brag-sheet-mcp`) or via
  the Claude Code plugin manifest.

**Why:**

- Surgical changes only. Touching install scripts to "auto-detect engine"
  is a separate, riskier feature that needs its own design discussion
  (what does "detect" mean? what about machines with multiple engines?).
- Keeping the two entry points cleanly separated means a regression in
  one path can't take down the other.

**Follow-up:** A future PR can teach `install.ps1` / `install.sh` to also
register the MCP server with Claude Code / Codex / Cursor when those CLIs
are detected on `$PATH`. Out of scope here.

---

## 5. Version → **v1.1.0 (additive, not breaking)**

**Decision:** When this work ships, bump to **`1.1.0`**. The version bump
itself is **not done in this PR** — that's a separate decision tied to
release timing.

**Why `1.1.0`:**

- Pure addition: new `bin` entry, new optional manifest, no change to
  existing exports, install behaviour, or data layout.
- Existing users who do `npm i -g copilot-brag-sheet` get the new
  `copilot-brag-sheet-mcp` binary alongside the old one — no migration
  required.
- SemVer minor is the textbook fit ("backwards-compatible functionality
  added").

**Why v2.0.0 was rejected:** A major bump signals breaking changes; there
are none. Reserving v2 for the hooks/auto-tracking work (question 2)
keeps the version line meaningful.

[issue #22]: https://github.com/microsoft/copilot-brag-sheet/issues/22

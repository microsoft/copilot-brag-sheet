# RFC: Summary Inference

> **Status:** Draft — design only, no implementation  
> **Tracking issue:** [microsoft/copilot-brag-sheet#7](https://github.com/microsoft/copilot-brag-sheet/issues/7)  
> **Target version:** v1.1.0 (opt-in), v2.0.0 (default-on)  
> **Author:** Brag Sheet maintainers  
> **Last updated:** 2025

---

## TL;DR

Today the brag sheet pitches itself as **automatic** ("auto-log every Copilot CLI session", "automatic brag sheet"), but the *impact log* — the artifact that actually matters at performance review time — only exists when the user types the magic word `brag`. Session records are captured passively, but they never become entries unless the user remembers to ask.

This RFC proposes **Summary Inference**: a passive layer that watches the existing session record, detects significant work using deterministic heuristics, and emits **suggestion** records the user can review and promote into entries on their own time. Suggestions are never auto-promoted. Inference is opt-in in v1.1.0 and on-by-default in v2.0.0.

**Recommendation: Option E (Hybrid).** End-of-session passive note + dedicated `review_suggestions` tool. Justification in §3.

---

## Open questions (for reviewer)

These are the decisions that would benefit most from a second opinion before implementation begins:

1. **Visibility during session vs after.** Do we surface "we noticed you shipped X" mid-session as an ephemeral hint, or stay silent until the session ends? Mid-session is more discoverable but interrupts flow. The hybrid recommendation defers the user-facing message to `onSessionEnd`, but a future refinement could add a single mid-session ping after the *first* high-confidence signal of the session.
2. **False-positive tolerance.** The heuristic is deliberately conservative (see §4) — we'd rather miss a brag than fabricate one. Is that the right bias, or should we err the other way given that the user can dismiss bad suggestions trivially?
3. **MCP coupling.** Inference runs inside `extension.mjs` today, which is Copilot CLI only. The cross-engine MCP work (`docs/cross-engine-spec.md`, issue #22) will need to lift this into a shared lib. Should we block Phase 1 on the MCP scaffold, or build it inline now and refactor when MCP lands?

Other secondary questions raised during drafting:

- Per-repo / per-category disable lists? (Yes, but defer to v1.2.)
- Should suggestions expire if not reviewed? (Yes, 90 days, see §6.)
- Do we sync suggestions to git backup? (No — keep them local until accepted.)

---

## 1. Problem

### 1.1 The pitch

From `README.md`:

> Turn vague "what did I do?" into evidence-backed impact statements — **automatically, every Copilot CLI session**.
> Every time you use GitHub Copilot CLI, this extension automatically:
> - Tracks your session — repo, branch, files edited/created, PRs, git actions
> - Captures context — first prompt as task description, session duration

And in the "Why an extension, not just a SKILL.md?" section:

> Want it to **actually happen automatically**? Install the extension below.

### 1.2 The reality

Today, the lifecycle is:

1. `onSessionStart` writes a `sessionRecord` to `~/<dataDir>/sessions/YYYY/MM/*.json`.
2. `onPostToolUse` mutates that record incrementally — `filesEdited`, `filesCreated`, `prsCreated`, `significantActions`.
3. `onSessionEnd` finalizes it (`status: "finalized"`, `endTime`, optionally a `summary` from `input.finalMessage`).
4. **Nothing else happens** unless the user types something matching `/\bbrag\b/i`, in which case `onUserPromptSubmitted` injects a hint nudging the agent to call `save_to_brag_sheet`.

The *session* record is a low-fidelity activity log. The *entry* record is the high-fidelity, impact-framed thing that goes into the performance review. We currently produce roughly 1 entry per ~20 sessions (anecdotal — measure this; see §8). That ratio is the product gap.

### 1.3 The competitive moat

A SKILL-only competitor (see e.g. `claudskills.com`) only has the *prompt*. They cannot detect work — they can only react to the user invoking them. We have:

- `sessionRecord.filesEdited` — knows what changed
- `sessionRecord.prsCreated` — knows what shipped
- `sessionRecord.significantActions` — knows when `git push` / `git commit` happened
- `sessionRecord.taskDescription` — knows the user's intent

This is a *passive sensor network*. Letting it sit idle is leaving the moat unused. **Summary Inference is the feature that converts the moat into a product.**

### 1.4 What success looks like

Quantitatively:

- ≥40% of sessions with at least one PR opened produce an accepted suggestion within 7 days.
- ≥80% of accepted suggestions are accepted **without edits** (i.e. the proposed text was good enough).
- ≤2% of suggestions are dismissed with reason `false_positive` (the heuristic was wrong about significance).
- Zero suggestions emitted on no-op sessions (sessions whose only activity is `git status`-style reads).

Qualitatively:

- Users feel the brag sheet is "watching their back" without nagging.
- The phrase "I forgot to log" becomes rarer in user feedback.

---

## 2. Defining "significant work"

A session is *significant* if it produced output someone would point to in a self-review. Below is the candidate signal catalog. Each row maps to fields already populated by `onPostToolUse`.

| # | Signal | Detection | Confidence |
|---|--------|-----------|------------|
| S1 | **PR opened** | `sessionRecord.prsCreated.length > 0` | 0.85 |
| S2 | **Substantive PR** | S1 ∧ (`filesEdited.length + filesCreated.length ≥ 3`) | 0.90 |
| S3 | **Design / docs work** | ≥2 `.md` files in `filesCreated` ∪ `filesEdited`, with paths matching `/(^|\/)(docs|design|rfc|adr)\//i` | 0.75 |
| S4 | **Bug fix language** | `taskDescription` matches `/\b(fix|bug|broken|regression|crash|hang|leak|race|deadlock)\b/i` ∧ ≥1 file changed | 0.65 |
| S5 | **On-call / incident** | `taskDescription` ∪ first prompt matches `/\b(incident|outage|sev[\s-]?[0-9]|icm|mttr|restored|mitigated|pager)\b/i` | 0.85 |
| S6 | **Migration / refactor** | ≥5 files changed under a common path prefix, none new | 0.55 |
| S7 | **Cross-team collab** | PR created in `repoFull` whose org differs from the session's prior repos that day (heuristic for "outside my team's repos") | 0.55 |
| S8 | **Multi-day continuation** | An earlier session within 72h shares ≥3 files with this one *and* this session ends with a PR | 0.70 |
| S9 | **Tooling / infra** | Path prefixes `infra/`, `terraform/`, `.github/workflows/`, `Dockerfile`, `pipelines/` | 0.60 |
| S10 | **Tests added** | Files matching `/(^|\/)(test|tests|__tests__|spec)\//i` created or edited, with non-test files also touched | 0.50 |

### 2.1 What is *not* a signal (deliberate exclusions)

- A session that only reads files (no `filesEdited`, no `filesCreated`, no `prsCreated`) — even if long.
- A session whose only edit is to `~/.copilot/` or other config dirs (already filtered by `addFileToRecord`).
- A session that crashed (`status: "orphaned"`) — incomplete data.
- A session whose `taskDescription` matches `/\b(test|try|experiment|playground|scratch)\b/i` — explicit user signal that this is throwaway.

### 2.2 Combining signals

A session emits **at most one suggestion**. If multiple signals fire, pick the one with highest confidence; secondary signals become `signals[]` metadata on the suggestion (useful for debugging and for the LLM enhancement layer in Phase 2).

Threshold: emit a suggestion only if max signal confidence ≥ **0.60**. This is intentionally conservative (see open question #2).

---

## 3. UX options

| Option | When | Pros | Cons |
|---|---|---|---|
| **A. Mid-session prompt** | After a signal fires, hook injects "Want to log this?" via `additionalContext` on the next prompt | Catches user in flow, highest accept rate | Interrupts focus; risks looking like nag-ware; conflicts with the agent's current task |
| **B. Session-end summary** | `onSessionEnd` → `sessionSummary` includes "Suggested brag: ..." | Non-disruptive; user has full context of what just happened | User has already moved on; may be ignored |
| **C. New tool `suggest_brag_entries()`** | Pure pull: user/agent invokes it on demand | Pure opt-in, zero surprise | Defeats the "automatic" pitch entirely |
| **D. Background daily/weekly digest** | A periodic task scans the last N days of unlogged work | Lowest friction during sessions | Requires a scheduler we don't have; user has to come back |
| **E. Hybrid (recommended)** | `onSessionEnd` writes a *passive suggestion record* + a one-line note in the session-end output ("📊 1 suggestion pending — run `review-suggestions` to see"). User materializes it later via `review_suggestions` / `accept_suggestion` tools. | Non-interruptive, discoverable, opt-in to actually save, no scheduler needed | More code (two tools + a record type); two-step UX |

### 3.1 Recommendation: Option E

**Reasoning:**

- **Respects flow.** Nothing happens mid-session. The agent isn't nudged to do something other than the user's actual task.
- **Discoverable.** The single-line note in `sessionSummary` is the user's prompt to come back later. We already control that field — see `extension.mjs:370-373`.
- **Honest pitch.** The README can truthfully say "we suggest brags from your work; you decide what to keep" — closer to reality than today's "automatic" framing, while still automatic in the sense the user doesn't have to *remember*.
- **Auditable.** Suggestion records live as JSON in `<dataDir>/suggestions/`, same shard layout as sessions/entries. Easy to grep, easy to version with git backup, easy to delete.
- **No scheduler.** Option D requires a daemon or cron — out of scope for a zero-deps extension that runs only when Copilot CLI runs.

**Why not A?** Even a polite mid-session injection competes with the user's current task for the agent's attention budget. We'd rather be ignored on session-end than annoying mid-flow.

**Why not B alone?** The text in `sessionSummary` is volatile (host may not display it). We need a durable artifact — hence the suggestion record alongside.

**Why not C alone?** Forces the user to *remember* to ask. The whole point of this RFC is to remove that requirement.

---

## 4. Algorithm

### 4.1 Where in the lifecycle

Inference runs in **`onSessionEnd`**, after the existing finalization. Rationale:

- All signals are accumulated by `onPostToolUse` already; no new state needed.
- Session-end has the full picture (`taskDescription`, complete file list, final PRs).
- Adds zero overhead to the hot path (`onPostToolUse` runs after every tool call).
- Failures are isolated — a thrown error inside inference is caught by the existing `try/catch` and logged via `logError`, never breaking the session record finalization.

We considered debounced inference inside `onPostToolUse` (e.g. fire when `prsCreated` first becomes non-empty). Rejected: complicates state, doubles the surface area for bugs, and the latency benefit is negligible since suggestions are reviewed asynchronously.

### 4.2 State

No new in-process state. Inference reads the in-memory `sessionRecord` (which is already kept in sync with disk by `updateRecord`) plus, for signal **S8** (multi-day continuation), reads the last 72h of session records via `readRecords(dataDir, { since })`.

### 4.3 Heuristic vs LLM-based

**Phase 1 is heuristic-only.** Reasons:

- **Zero deps.** The brand. No new package dependencies, no SDK calls.
- **Deterministic.** Easy to unit-test, easy to explain, easy to debug.
- **Fast.** Pure function over the session record; sub-millisecond.
- **Privacy.** No content leaves the machine.

**Phase 2 layers an LLM enhancement** on top: when `@github/copilot-sdk` exposes a model-call API (it doesn't yet, AFAICT — verify before implementing), the heuristic identifies the *signal* and the LLM rewrites the proposed summary to be punchier and impact-framed. The LLM never *creates* a suggestion that the heuristic didn't first flag — this caps hallucination risk.

### 4.4 Pseudocode

```js
// runs at end of onSessionEnd, after the record is finalized
function inferSuggestion(sessionRecord, recentSessions, config) {
  if (config.inference?.enabled !== true) return null;
  if (sessionRecord.status !== "finalized") return null;

  const exclusions = checkExclusions(sessionRecord);
  if (exclusions.length > 0) return null;

  const signals = [
    detectPrOpened(sessionRecord),
    detectSubstantivePr(sessionRecord),
    detectDocsWork(sessionRecord),
    detectBugFix(sessionRecord),
    detectIncident(sessionRecord),
    detectMigration(sessionRecord),
    detectCrossTeam(sessionRecord, recentSessions),
    detectMultiDay(sessionRecord, recentSessions),
    detectInfra(sessionRecord),
    detectTestsAdded(sessionRecord),
  ].filter(Boolean);

  if (signals.length === 0) return null;

  const primary = signals.sort((a, b) => b.confidence - a.confidence)[0];
  if (primary.confidence < 0.60) return null;

  return {
    id: randomUUID(),
    type: "suggestion",
    timestamp: new Date().toISOString(),
    sessionId: sessionRecord.id,
    repo: sessionRecord.repo,
    branch: sessionRecord.branch,
    signals: signals.map(s => ({
      kind: s.kind,
      confidence: s.confidence,
      evidence: s.evidence,
    })),
    proposedSummary: composeSummary(primary, sessionRecord),
    proposedCategory: primary.category,
    proposedImpact: composeImpact(primary, sessionRecord),
    confidence: primary.confidence,
    status: "pending",
    expiresAt: addDays(new Date(), 90).toISOString(),
  };
}

function composeSummary(signal, record) {
  // Deterministic templates — no LLM in Phase 1
  switch (signal.kind) {
    case "pr-substantive":
      return `Opened PR "${record.prsCreated[0].title}" in ${record.repoFull || record.repo} (${record.filesEdited.length + record.filesCreated.length} files changed)`;
    case "docs":
      return `Wrote ${countMd(record)} doc(s) in ${record.repo}: ${listMdPaths(record).join(", ")}`;
    case "bug-fix":
      return `Investigated and patched: ${truncate(record.taskDescription, 120)}`;
    case "incident":
      return `Worked an incident: ${truncate(record.taskDescription, 120)}`;
    // ... one template per signal kind
    default:
      return `Made ${record.filesEdited.length + record.filesCreated.length} change(s) in ${record.repo}`;
  }
}

function composeImpact(signal, record) {
  // Phase 1 returns "(evidence needed)" honestly when it doesn't know.
  // Phase 2 LLM layer can replace this with a generated draft.
  if (record.prsCreated[0]) {
    const pr = record.prsCreated[0];
    return `PR ${pr.id ? `#${pr.id}` : ""} in ${pr.repo || record.repo} — (impact needed)`;
  }
  return "(evidence needed)";
}
```

The full set of `detectX` functions lives in a new `lib/inference.mjs` (planned, not implemented in this RFC).

### 4.5 Storage

Suggestions get a new subdir: `<dataDir>/suggestions/YYYY/MM/<timestamp>_<id>.json`, mirroring sessions/entries. This requires extending `TYPE_TO_SUBDIR` in `lib/storage.mjs`:

```js
const TYPE_TO_SUBDIR = {
  session: "sessions",
  entry: "entries",
  suggestion: "suggestions",   // NEW
};
```

`writeRecord`, `readRecords`, `updateRecord`, `findRecordFile` all extend transparently. The atomic-write pattern is already correct.

### 4.6 Lifecycle of a suggestion

```
            ┌──────────────┐
            │ onSessionEnd │
            └──────┬───────┘
                   │ heuristic fires
                   ▼
            ┌──────────────┐
            │   pending    │
            └──┬────────┬──┘
   review_     │        │   dismiss_
   suggestion  │        │   suggestion
   (accept)    │        │
               ▼        ▼
         ┌──────────┐  ┌──────────┐
         │ accepted │  │dismissed │
         └────┬─────┘  └──────────┘
              │ promotes to entry
              ▼
         ┌──────────┐
         │  entry   │
         └──────────┘
```

When a suggestion is accepted, we **do not delete** the suggestion record. We update its `status` to `"accepted"` and add a `promotedTo: <entryId>` field. Provides an audit trail; lets us measure accept-without-edit rate (one of the success metrics in §1.4).

Suggestions older than 90 days with `status: "pending"` are auto-marked `expired` on next session start (cheap GC). Never deleted from disk — let `git gc` and the user's filesystem handle that.

---

## 5. Privacy & safety

### 5.1 New risk surface

Until now, every byte the brag sheet has stored was either (a) a fact about the session (file path, PR number) or (b) text the user explicitly typed. Inference introduces a new category: **generated text**. That changes the threat model.

| Risk | Mitigation |
|---|---|
| **Hallucinated impact statements** | Phase 1 uses deterministic templates only. No prose generation. Templates fall back to `(evidence needed)` rather than inventing metrics. (Already enforced by SKILL.md rule #7 — apply same rule to inference.) |
| **Echoing secrets in proposed summary** | Don't include `taskDescription` verbatim if it matches secret patterns. Reuse the redaction work tracked for v1.0.4 (issue TBD); inference depends on it landing first or shipping its own minimal redactor. |
| **PR titles can leak internal info** | PR titles are *already* in `sessionRecord.prsCreated[].title`. Suggestion records inherit the same exposure as session records — no net-new leak. |
| **Suggestions from another user's session** | Sessions are scoped to a single OS user via `dataDir` (`~/.../<user>/...`). No multi-user shared dataDir exists. If we add one (e.g. team brag sheet), this RFC needs a follow-up. |
| **Git backup of suggestions** | **Do not** sync the `suggestions/` subdir to the git remote until the user accepts. Add `suggestions/` to the data dir's `.gitignore` by default. Once accepted, the entry record (which goes through the user's existing review) is what gets pushed. |
| **Auto-promotion** | Never. Suggestions only become entries via explicit `accept_suggestion` call. Document this prominently in the README. |
| **Disable** | New config field `inference.enabled` (default `false` in v1.1.0, `true` in v2.0.0). When false, inference code is short-circuited; no suggestion records produced; existing tools still work. |
| **Per-repo opt-out** | Defer to v1.2 (see open question). Workaround: user can ignore individual suggestions. |

### 5.2 Behavioural guardrails (mirrors `skills/brag-sheet/SKILL.md`)

Inference templates must obey the same rules the SKILL enforces on the LLM:

- **DO** include all three parts (action → result → evidence) — or honestly write `(evidence needed)`.
- **DO NOT** fabricate metrics, team sizes, or impact numbers.
- **DO NOT** silently drop weak evidence — surface it as `(evidence needed)`.

This keeps inference output stylistically identical to LLM-generated entries, so users can't tell which entries were "just a template" vs "the LLM polished it" — which is the point.

---

## 6. Schema additions

### 6.1 New record type: `suggestion`

```jsonc
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "type": "suggestion",
  "source": "inference",                 // vs "manual" / "copilot-cli"
  "timestamp": "2025-04-30T18:22:11.420Z",
  "sessionId": "abc123",                 // FK to session record
  "repo": "copilot-brag-sheet",
  "repoFull": "microsoft/copilot-brag-sheet",
  "branch": "rfc-summary-inference",

  "signals": [
    {
      "kind": "pr-substantive",
      "confidence": 0.90,
      "evidence": {
        "prCount": 1,
        "filesChanged": 7,
        "prTitle": "docs(rfc): summary inference design"
      }
    },
    {
      "kind": "docs",
      "confidence": 0.75,
      "evidence": { "mdFiles": ["docs/summary-inference-rfc.md"] }
    }
  ],

  "proposedSummary": "Opened PR \"docs(rfc): summary inference design\" in microsoft/copilot-brag-sheet (1 file changed)",
  "proposedCategory": "design",
  "proposedImpact": "PR #42 in microsoft/copilot-brag-sheet — (impact needed)",
  "confidence": 0.90,

  "status": "pending",                   // pending | accepted | dismissed | expired
  "expiresAt": "2025-07-29T18:22:11.420Z",
  "promotedTo": null,                    // entryId once accepted
  "dismissReason": null
}
```

Fields are append-only after creation except `status`, `promotedTo`, and `dismissReason`. Sanitization rules from `lib/records.mjs` apply to all string fields.

### 6.2 New tools (3)

#### `review_suggestions(args)`

Lists pending suggestions. Read-only.

```js
{
  name: "review_suggestions",
  description: "List pending brag suggestions inferred from recent Copilot CLI sessions. Use to see what the brag sheet noticed automatically before deciding what to log.",
  parameters: {
    type: "object",
    properties: {
      since: { type: "string", description: "ISO timestamp; default 30 days ago" },
      repo: { type: "string", description: "Filter by repo" },
      minConfidence: { type: "number", description: "0.0–1.0; default 0.60" },
      limit: { type: "number", description: "default 20" }
    }
  }
}
```

Returns an array of suggestion records (status=pending, not expired) ordered by `confidence` desc.

#### `accept_suggestion(args)`

Promotes a suggestion to a real entry record.

```js
{
  name: "accept_suggestion",
  description: "Promote a pending suggestion to a brag sheet entry. Optionally edit the summary, category, impact, or tags before saving.",
  parameters: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", description: "Suggestion id from review_suggestions" },
      summary: { type: "string", description: "Override proposedSummary" },
      category: { type: "string" },
      impact: { type: "string" },
      tags: { type: "array", items: { type: "string" } }
    }
  }
}
```

Behaviour:

1. Load the suggestion. Fail if not found, not pending, or expired.
2. Build an `entryRecord` via `createEntryRecord` using the suggestion's proposed values, with caller-provided overrides taking precedence.
3. Write the entry.
4. Update the suggestion: `status = "accepted"`, `promotedTo = <entryId>`.
5. Return the entry id and a render-friendly preview.

#### `dismiss_suggestion(args)`

Marks a suggestion as dismissed. Used both for "this isn't brag-worthy" and "I already logged this."

```js
{
  name: "dismiss_suggestion",
  description: "Dismiss a pending brag suggestion. Use when a suggestion is wrong, duplicate, or not worth logging.",
  parameters: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string" },
      reason: {
        type: "string",
        enum: ["false_positive", "duplicate", "not_significant", "already_logged", "other"],
        description: "Why dismissing — used to tune heuristics"
      }
    }
  }
}
```

The `reason` field is the **single most important telemetry signal** we'll get from real users. We aggregate dismissal reasons in `review_brag_sheet` output (under a "tuning" footer) so users can see their own pattern.

### 6.3 Existing tools — unchanged

`save_to_brag_sheet`, `review_brag_sheet`, `generate_work_log` are not modified. Inference is purely additive.

### 6.4 Config additions

```jsonc
// data dir's config.json
{
  "inference": {
    "enabled": false,                  // default in v1.1.0; flips to true in v2.0.0
    "minConfidence": 0.60,             // emission threshold
    "showSessionEndHint": true,        // controls the one-liner in sessionSummary
    "expireAfterDays": 90,
    "disabledRepos": [],               // v1.2; ignored in v1.1
    "disabledCategories": []           // v1.2; ignored in v1.1
  }
}
```

`loadConfig` in `lib/config.mjs` gets these defaults. Missing config behaves as if `enabled: false`.

---

## 7. Implementation plan

### Phase 1 — Heuristic (target: v1.1.0)

| Task | Files | Est. LOC |
|---|---|---|
| Add `suggestion` to `TYPE_TO_SUBDIR` | `lib/storage.mjs` | ~5 |
| New `lib/inference.mjs` with `inferSuggestion`, `composeSummary`, `composeImpact`, ten `detectX` helpers | new | ~250 |
| `createSuggestionRecord` + sanitization | `lib/records.mjs` | ~30 |
| Wire into `onSessionEnd` | `extension.mjs` | ~15 |
| Three new tools: `review_suggestions`, `accept_suggestion`, `dismiss_suggestion` | `extension.mjs` | ~120 |
| Suggestion expiry GC at `onSessionStart` (alongside orphan recovery) | `extension.mjs` | ~10 |
| Default-off config plumbing | `lib/config.mjs` | ~15 |
| `.gitignore` rule for `suggestions/` in git-backup init | `lib/git-backup.mjs` | ~5 |
| Tests (see §8) | `test/` | ~200 |
| README + ROADMAP + CHANGELOG updates | docs | ~80 |
| **Total** | | **~730** |

Acceptance: every test in §8 passes; `BRAG_SHEET_DEBUG=1` shows when inference fires; opt-in works; opt-out works; existing functionality untouched.

### Phase 2 — LLM enhancement (target: v1.2 or v1.3)

Depends on `@github/copilot-sdk` exposing a model-call API (verify availability). When available:

- New `lib/inference-llm.mjs` (~50 LOC) wraps the deterministic suggestion in a model call to rewrite `proposedSummary` and `proposedImpact` in the user's preset voice (Microsoft Connect, plain, etc.).
- Heuristic still runs first; LLM never invents new signals.
- Falls back silently if the SDK isn't available — keep zero deps.
- Gated by a separate config flag `inference.useLlm` so the privacy-sensitive can keep the heuristic version.

### Phase 3 — Cross-engine via MCP (target: v2.0.0)

Depends on `docs/cross-engine-spec.md` / issue #22 landing.

- Move `lib/inference.mjs` (already shared) into the MCP server's tool set.
- The three new tools (`review_/accept_/dismiss_suggestion`) become MCP tools, instantly available in Claude Code, Codex CLI, Agency.
- Hooks (`onSessionEnd` equivalent) provided via `hooks.json` for the engines that support it.

No new design work needed in Phase 3 — it's a packaging move.

---

## 8. Test plan

The repo already has a test runner (`test/`); follow existing patterns.

### 8.1 Unit tests (one per heuristic)

```
test/inference/detect-pr-opened.test.mjs
test/inference/detect-substantive-pr.test.mjs
test/inference/detect-docs-work.test.mjs
test/inference/detect-bug-fix.test.mjs
test/inference/detect-incident.test.mjs
test/inference/detect-migration.test.mjs
test/inference/detect-cross-team.test.mjs
test/inference/detect-multi-day.test.mjs
test/inference/detect-infra.test.mjs
test/inference/detect-tests-added.test.mjs
```

Each takes a hand-crafted `sessionRecord` fixture and asserts confidence value and evidence shape.

### 8.2 Snapshot tests for proposed text

```
test/inference/compose-summary.snapshot.mjs
```

Asserts that `composeSummary` output for a given fixture matches a golden file. Catches accidental template regressions.

### 8.3 Property test: zero false positives on no-op sessions

```
test/inference/no-op-sessions.test.mjs
```

Generate 1000 fixture sessions where `filesEdited`, `filesCreated`, `prsCreated`, `significantActions` are all empty (random `taskDescription`). Assert `inferSuggestion` returns `null` for all of them.

### 8.4 Lifecycle tests (suggestion → entry)

```
test/tools/accept-suggestion.test.mjs
test/tools/dismiss-suggestion.test.mjs
test/tools/review-suggestions.test.mjs
```

Cover:

- accept with no overrides → entry has proposed values
- accept with overrides → entry has overridden values, suggestion has both proposed (preserved) + the new entryId
- accept twice → second call fails with `not pending`
- dismiss → status flips, no entry created
- review filters by `since`, `repo`, `minConfidence`

### 8.5 Subprocess / E2E test

Mirror the existing extension subprocess tests:

```
test/e2e/inference-end-to-end.test.mjs
```

1. Spawn a fake Copilot CLI session that creates a file, commits, opens a PR (mocked).
2. Trigger `onSessionEnd`.
3. Assert a suggestion record exists in `<dataDir>/suggestions/`.
4. Call `review_suggestions` → got 1.
5. Call `accept_suggestion` → got entry.
6. Call `review_suggestions` again → got 0.

### 8.6 Privacy regression test

```
test/inference/no-secret-leak.test.mjs
```

Plant a fake secret-shaped string (`AKIA...`) in `taskDescription`. Run inference. Assert it does not appear in `proposedSummary` / `proposedImpact`. (Once redaction lib is in place.)

---

## 9. Rollout

| Version | Behavior |
|---|---|
| **v1.1.0** | Inference shipped, **off by default**. Users opt in via `{ "inference": { "enabled": true } }`. CHANGELOG + README "What's new" section explains tradeoffs. Solicit feedback on issue #7. |
| **v1.1.x** | Tune heuristics based on dismissal-reason telemetry from opt-in users. |
| **v1.2.0** | Add per-repo / per-category disable lists if demanded. Optional: Phase 2 LLM enhancement behind `inference.useLlm`. |
| **v2.0.0** | Inference **on by default**. Off-switch still available. Coincides with cross-engine MCP rollout (Phase 3). README pitch updated to honest "we suggest, you decide." |

Migration: opt-in v1.1 → v2.0 is automatic (config field already there, just default flips). Users who explicitly set `enabled: false` keep that setting.

Backward compat: suggestion records are a new type; older versions of the extension that don't know about them ignore them (because `getSelectedSubdirs` only returns known subdirs). No data migration needed.

---

## 10. Why this design and not the alternatives

### "Just have the LLM do it"

Tempting — let the model read the session record and write the suggestion. We rejected it for Phase 1 because:

- It depends on a model-call SDK we don't have a stable contract with.
- It costs tokens / money on every session, even ones with nothing to log.
- It's non-deterministic and hard to test.
- It's the *enhancement layer*, not the foundation. Heuristic-first lets us ship something correct, then make it pretty.

### "Just teach the SKILL to do it"

The SKILL already tries — it tells the LLM how to frame entries. But the SKILL only fires when invoked. Inference is the missing link: the layer that decides *when* the SKILL is relevant without the user asking.

### "Auto-promote high-confidence suggestions"

A user once said "if you're 95% sure, just save it." We don't, because:

- The cost of a wrong save is much higher than the cost of an extra click. A bogus entry in someone's perf-review file is worse than a missed brag.
- Trust is asymmetric. One auto-saved bad entry damages confidence for months.
- The accept tool is one tool call away. The friction is minimal.

We may revisit at v3.

### "Build a full ML model"

No. The brand is zero-deps, deterministic, runs on a laptop offline. A 200-line heuristic that catches 80% of significant work beats a model that catches 90% but requires a download.

---

## Appendix A — Mapping signals to existing record fields

For implementers, every signal must be derivable from fields already populated by `extension.mjs` as of `main`:

| Signal | Source field(s) |
|---|---|
| S1 PR opened | `prsCreated` |
| S2 Substantive PR | `prsCreated`, `filesEdited`, `filesCreated` |
| S3 Docs work | `filesCreated`, `filesEdited` (path filter) |
| S4 Bug fix | `taskDescription` (regex) |
| S5 Incident | `taskDescription` (regex) |
| S6 Migration | `filesEdited` (path-prefix clustering) |
| S7 Cross-team | `repoFull`, plus `readRecords({ since: today, type: "session" })` for prior repos |
| S8 Multi-day | `readRecords({ since: 72h ago, type: "session" })` |
| S9 Infra | `filesEdited`, `filesCreated` (path filter) |
| S10 Tests added | `filesEdited`, `filesCreated` (path filter) |

No new instrumentation in `onPostToolUse` is required.

---

## Appendix B — Example end-to-end flow

User runs Copilot CLI in a repo, asks the agent to fix a bug, the agent edits 4 files, commits, pushes, opens a PR. User exits.

**Today:** A session record is written. Nothing else.

**With this RFC:**

1. `onSessionEnd` runs the heuristic.
2. Signals fire: S1 (pr-opened, 0.85), S2 (pr-substantive, 0.90), S4 (bug-fix, 0.65).
3. Primary = S2. Suggestion record written to `suggestions/2025/04/<ts>_<id>.json`.
4. `sessionSummary` returns: `"Bug fix shipped — 1 brag suggestion pending. Run review_suggestions to see."`.
5. Two days later, user runs `copilot` again. Says "what did I forget to log?". Agent calls `review_suggestions`.
6. Agent shows the suggestion. User says "yes, accept it but reword it as 'Fixed token refresh race → eliminated 401 errors'."
7. Agent calls `accept_suggestion(id, summary: "...")`. Entry record written. Suggestion marked accepted.
8. Next time the user generates a work log, the entry shows up.

Compare to today, where step 1 is "user remembers and types `brag` mid-session" — which is exactly the behaviour the README pretends doesn't exist.

---

*End of RFC.*

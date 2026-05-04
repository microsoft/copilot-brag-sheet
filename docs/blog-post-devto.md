---
title: I Kept Forgetting What I Shipped—So I Built a Copilot CLI Brag-Doc Generator
published: false
description: Every performance review, I forget half of what I shipped. So I built an extension that quietly logs every AI coding session into a structured work log. Here's how it works.
tags: opensource, productivity, ai, career
cover_image: https://raw.githubusercontent.com/microsoft/copilot-brag-sheet/main/demo/demo.gif
canonical_url: https://github.com/microsoft/copilot-brag-sheet
---

It's review season. You open a blank doc titled "H2 accomplishments" and stare at it. You scroll through six months of `git log`. You squint at PR titles like "fix flaky test" and try to remember whether that was the cursed database migration or the *other* cursed database migration.

I do this every six months. I always swear I'll keep a running brag doc next time. I never do.

So I built a thing.

## The problem nobody admits to

Engineers forget their work. Not the big stuff — you remember the launch. But the *texture* of your impact gets lost: the tooling that quietly saved your team hours, the on-call investigation that surfaced a config drift nobody knew about, the design doc that killed a bad idea before it shipped.

By review time, you're reconstructing six months from `git log --author=you` and foggy memory. The good stuff — the *why* and the *result* — is gone.

## What I tried before

- **`git log` archaeology.** Tells you *what* changed, not *why it mattered*. "Bumped version" is not a brag.
- **Manual notes.** I lasted three weeks. Once.
- **Existing brag-doc playbooks.** The pattern works, but it requires the discipline I don't have.

The pattern: any system that depends on me remembering to log things is going to fail. The logging has to happen on its own.

## The idea

I use Copilot CLI for most of my coding now. It already knows what I'm doing — what files I'm editing, what PRs I'm opening, what commits I'm pushing. That data is just sitting there in `~/.copilot/session-state/` doing nothing.

What if a Copilot CLI extension just… watched, and quietly wrote it all down?

That's [`copilot-brag-sheet`](https://github.com/microsoft/copilot-brag-sheet).

## How it works

Zero dependencies, Node 18+, runs everywhere.

```
┌─────────────────┐    hooks     ┌──────────────────┐
│  Copilot CLI    │ ───────────> │  brag-sheet ext  │
│   session       │              │                  │
└─────────────────┘              │  • files edited  │
                                 │  • PRs created   │
                                 │  • git actions   │
                                 │  • task summary  │
                                 └────────┬─────────┘
                                          │ atomic writes
                                          ▼
                              <data-dir>/sessions/2025/11/
                                  └─ <timestamp>_<id>.json
```

The extension registers four hooks:

- `onSessionStart` — opens a session record, detects repo + branch, recovers orphaned sessions from any crashed run
- `onUserPromptSubmitted` — captures your first prompt as the task description
- `onPostToolUse` — tracks file edits, PR creation, and git actions incrementally
- `onSessionEnd` — finalizes the record

Plus three tools you can call from inside any session:

| Tool | What it does |
|---|---|
| `save_to_brag_sheet` | Manually log something significant with a category + impact statement |
| `review_brag_sheet` | Render the last N weeks of work as markdown, grouped by week |
| `generate_work_log` | Export the whole thing to a single file |

<!-- Embedded demo: brag → save → review loop in a real Copilot CLI session -->
![demo of the brag → save → review flow in a Copilot CLI session](https://raw.githubusercontent.com/microsoft/copilot-brag-sheet/main/demo/demo.gif)

You don't memorize a trigger word — talk naturally about your work and the agent picks it up. Things that fire `save_to_brag_sheet`:

> brag · log work · save accomplishment · what did I ship · prep my brag sheet · promo packet · Connect prep · weekly recap

## Example output

```markdown
## Week of 2025-11-10

### 🚀 Pull Requests
- **Migrated dashboard backups to version-controlled repo**
  Did: Moved dashboard JSON exports to a per-team private repo with versioning.
  Result: Restores went from "page someone with prod access" to git checkout.
  Evidence: PR #4421, 3 teams onboarded in week 1.

### 🚨 On-call
- **Root-caused 504s in production API**
  Did: Traced cascading timeouts to a misconfigured service mesh retry budget.
  Result: P95 latency dropped from 8s to 230ms.
  Evidence: Incident #632891, monitoring dashboard link.
```

Every entry follows the same format: **Did X → Result Y → Evidence Z**. If you can't fill in all three parts, it's probably not a brag — it's just a task.

## Two things I learned building it

**1. Atomic writes are non-negotiable when your data dir lives in OneDrive.**

I originally just did `fs.writeFile`. Then OneDrive sync grabbed a half-written JSON file mid-write and corrupted my entire month. Now every write is `tmp file → fsync → rename`, which is atomic on every OS I care about.

**2. Zero dependencies was worth the pain.**

I wanted SQLite. Node 18 doesn't have built-in SQLite. I wanted YAML. That's a parser dep. Each one is fine in isolation, but a tool that lives in your shell config and runs on every session start should not have a `node_modules` graph. JSON files in sharded directories turned out to be plenty.

107 tests, all green, no `node_modules`. That part feels good.

## Try it

```bash
npm install -g copilot-brag-sheet
copilot-brag-sheet            # copies files into ~/.copilot/extensions/, runs setup
```

Then `/clear` (or restart) Copilot CLI. On your first message you'll see `📊 Work logger active`. Use Copilot like normal. In a few weeks, ask "review my work" — you'll have something to put in that blank review doc.

> Also listed in [github/awesome-copilot](https://github.com/github/awesome-copilot) as a community skill if you just want the prompt-only version.

- **Repo**: [microsoft/copilot-brag-sheet](https://github.com/microsoft/copilot-brag-sheet) (MIT)
- **npm**: [`copilot-brag-sheet`](https://www.npmjs.com/package/copilot-brag-sheet)
- **Issues, PRs, weird ideas**: very welcome

If you've solved this problem differently — even with pen and paper — I genuinely want to hear about it. Drop a comment, open an issue, tell me what's missing. And if it saves you one hour of `git log` archaeology next review season, that's a win for both of us. ⭐

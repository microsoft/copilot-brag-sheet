# Copilot Brag Sheet

> **Turn vague "what did I do?" into evidence-backed impact statements** — automatically, every Copilot CLI session.

![demo](demo/demo.gif)

**🔒 Local-first · 🤝 MCP-conformant · 🚫 Zero telemetry**

A [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) extension that silently records your work as you go — files edited, PRs created, git actions — so when performance review season hits, you have receipts instead of a blank page. ([What's a brag sheet?](https://jvns.ca/blog/brag-documents/))

> 👋 **Microsoft engineer?** Jump to [Connect-optimized framing →](#microsoft-employees-connect--performance-reviews)

[![CI](https://img.shields.io/github/actions/workflow/status/microsoft/copilot-brag-sheet/ci.yml?branch=main&label=CI)](https://github.com/microsoft/copilot-brag-sheet/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/copilot-brag-sheet.svg)](https://www.npmjs.com/package/copilot-brag-sheet)
[![npm downloads](https://img.shields.io/npm/dm/copilot-brag-sheet.svg)](https://www.npmjs.com/package/copilot-brag-sheet)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Awesome Copilot](https://img.shields.io/badge/Awesome-Copilot-blue?logo=github)](https://github.com/github/awesome-copilot)

🌐 **Landing page:** [microsoft.github.io/copilot-brag-sheet](https://microsoft.github.io/copilot-brag-sheet/) · 🖼️ [Social preview](docs/og-image.png)

> **Requires:** Node.js 18+, [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) (with active Copilot subscription)

## Why an extension, not just a SKILL.md?

If you've seen the brag-sheet skill listed elsewhere — that's our [SKILL.md](skills/brag-sheet/SKILL.md), the LLM guidance file. It's a *prompt* that tells the agent how to think about your work. This repo ships the prompt **plus** the extension that makes it actually happen:

| Just the SKILL.md | The full extension (this) |
|---|---|
| LLM has to remember the trigger | Auto-captures every session |
| LLM runs shell commands by hand | Direct file/PR/git tracking via Node API |
| LLM formats markdown each time | Deterministic, typed, crash-safe |
| Markdown stored "somewhere" | Structured local JSON, atomic writes, orphan recovery |
| Re-curl to update | `npm update` or one-line re-install |

**Want just the prompt?** Use the skill — also published in [github/awesome-copilot](https://github.com/github/awesome-copilot).
**Want it to actually happen automatically?** Install the extension below.

## What It Does

Every time you use [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli), this extension automatically:

- 📊 **Tracks your session** — repo, branch, files edited/created, PRs, git actions
- 📝 **Captures context** — first prompt as task description, session duration
- 🔒 **Stores locally** — structured JSON records in your OS app-data directory
- 🚀 **Crash-safe** — atomic writes, orphan recovery, emergency shutdown saves

Plus three tools the agent can call on your behalf:

| Tool | What it does |
|------|-------------|
| `save_to_brag_sheet` | Save a work accomplishment to your impact log |
| `review_brag_sheet` | Review recent entries for performance discussions |
| `generate_work_log` | Render all records into a Markdown file |

### When the agent will use this

The agent picks up these tools when you say (anything close to) one of:

> brag · log work · save accomplishment · what did I ship · review my work · summarize my impact · generate work log · prep my brag sheet · promo packet · perf review · Connect prep · self-review · weekly recap · monthly summary · what did I do this quarter

You don't need to memorize the list — just talk naturally about your work and the agent will figure it out.

## Install (60 seconds)

> ⚠️ **Don't use `copilot plugin install`.** This is a [`joinSession()`](https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-with-mcp-and-extensions) extension and must live in `~/.copilot/extensions/`. Tracking [github/copilot-cli#3023](https://github.com/github/copilot-cli/issues/3023). Use one of the methods below.

### Recommended: one-liner

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/microsoft/copilot-brag-sheet/main/install.sh | bash

# Windows (PowerShell 5.1+)
irm https://raw.githubusercontent.com/microsoft/copilot-brag-sheet/main/install.ps1 | iex
```

The interactive setup wizard runs automatically when your terminal supports it.

### Alternative: from npm

```bash
npm install -g copilot-brag-sheet
copilot-brag-sheet                 # copies files + runs setup wizard
```

### For contributors

```bash
git clone https://github.com/microsoft/copilot-brag-sheet.git
cd copilot-brag-sheet
./install.sh          # macOS/Linux
.\install.ps1         # Windows
```

### Activate

After install, run `/clear` (or restart Copilot CLI). On your first message you'll see:

```
📊 Work logger active
```

Re-run setup anytime with `copilot-brag-sheet-setup` (after npm install) or `node ~/.copilot/extensions/copilot-brag-sheet/bin/setup.mjs`.

> Install failing? [Open an issue](https://github.com/microsoft/copilot-brag-sheet/issues/new) with the error — Windows + macOS + Linux are CI-tested.

## Use

### Two things you do, ever

**1. Say "brag" when you ship something.**

```
You: brag — refactored auth to managed identity, killed 3 secret-rotation incidents/qtr
Agent: [calls save_to_brag_sheet with summary, category, and impact]
```

**2. Run "generate my work log" before review season.**

```
You: generate my work log
Agent: [calls generate_work_log → writes a categorized markdown file you can paste into your perf doc]
```

Everything else (file tracking, PR detection, git actions) is automatic. Most users only do step 2 once per quarter.

### Optional: review recent work

```
You: show me my last 2 weeks
Agent: [calls review_brag_sheet]
```

## Examples

<details>
<summary><strong>What a session record looks like</strong> (auto-captured JSON)</summary>

Every Copilot CLI session automatically produces a JSON record like this:

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "type": "session",
  "timestamp": "2025-04-14T14:30:00.000Z",
  "endTime": "2025-04-14T15:45:00.000Z",
  "repo": "copilot-brag-sheet",
  "branch": "main",
  "cwd": "/home/user/repos/copilot-brag-sheet",
  "filesEdited": ["lib/config.mjs", "test/config.test.mjs"],
  "filesCreated": ["docs/backfill-guide.md"],
  "prsCreated": [],
  "significantActions": ["git commit", "git push"],
  "taskDescription": "Add Microsoft preset support to config",
  "status": "finalized"
}
```

You don't write these — they're captured automatically in the background.

</details>

### What a brag sheet entry looks like

When you (or the AI) calls `save_to_brag_sheet`:

```
You: "brag — shipped the auth service refactor"
Agent: I'll save that to your brag sheet.

  Summary: Refactored auth service to use managed identity → eliminated 3 secret 
           rotation incidents per quarter → reduced on-call burden for the team
  Category: infrastructure
  Impact: Eliminated recurring secret rotation incidents, improved team velocity
  
  ✅ Entry saved to brag sheet [infrastructure]: "Refactored auth service..."
```

The stored entry:

```json
{
  "type": "entry",
  "summary": "Refactored auth service to use managed identity → eliminated 3 secret rotation incidents per quarter",
  "category": "infrastructure",
  "impact": "Eliminated recurring secret rotation incidents, improved team velocity",
  "repo": "auth-service",
  "branch": "main"
}
```

### What the generated work log looks like

Running `generate_work_log` produces a Markdown file like this:

```markdown
# Work Impact Log

## Week of 2025-04-14

### 🚀 PRs & Features
- **[copilot-brag-sheet] Built and published v2 with modular architecture** — 107 tests, cross-platform CI

### 🏗️ Infrastructure
- **[auth-service] Refactored auth to managed identity** — Eliminated 3 secret rotation incidents/quarter

### 🚨 On-Call
- **[api-gateway] Mitigated cascading timeout incident** — Restored service in 12 min, 0 customer impact

## Week of 2025-04-07

### 🐛 Bug Fixes
- **[dashboard] Fixed timezone rendering in analytics charts** — Unblocked APAC team reporting
```

### What reviewing your work looks like

```
You: "review my work from the last 2 weeks"
Agent: [calls review_brag_sheet with weeks=2]

Here's your recent work:

## Week of 2025-04-14
### 🚀 PRs & Features
- **Built and published copilot-brag-sheet v2** — modular architecture, 107 tests

### 🏗️ Infrastructure  
- **Refactored auth service to managed identity** — eliminated secret rotation incidents

This looks strong for your Connect review. The auth refactor is a great 
example of reducing operational burden — want me to help frame it as a 
business impact statement?
```

<details>
<summary><strong>Microsoft preset in action</strong></summary>

With `{ "preset": "microsoft" }` in your config, the AI automatically frames entries for Connect:

```
You: "brag — I shipped the Grafana dashboard migration"

Agent: I'll frame this for Connect. Here's what I'd save:

  Summary: Led Grafana dashboard migration to Azure Managed Grafana → 
           consolidated 15 dashboards across 3 teams → reduced 
           monitoring infrastructure costs by 40%
  Category: infrastructure
  Impact: Reduced operational toil for SRE team, improved cross-team 
          visibility into service health metrics
  
  This aligns well with your Core Priority around operational excellence.
  Want me to save this?
```

</details>

<details>
<summary><strong>How It Works</strong> (internals — most users don't need this)</summary>

```
Session Start ──► Track files, PRs, git actions ──► Session End
     │                      │                            │
     ▼                      ▼                            ▼
  Create JSON          Update JSON                 Finalize JSON
  (status: active)     (incremental)               (status: finalized)
```

### Session State Machine

```
active ──► finalized        (normal session end)
active ──► emergency-saved  (process killed / crash)
active ──► orphaned         (recovered by next session)
```

### Storage Layout

```
<data-dir>/
├── sessions/2025/04/2025-04-14T20-00-00.000Z_<uuid>.json
├── entries/2025/04/2025-04-14T20-05-00.000Z_<uuid>.json
├── config.json    (optional)
└── errors.log
```

Default data directory:

| OS | Path |
|----|------|
| Windows | `%LOCALAPPDATA%\copilot-brag-sheet\` |
| macOS | `~/Library/Application Support/copilot-brag-sheet/` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/copilot-brag-sheet/` |

</details>

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COPILOT_HOME` | `~/.copilot` | Override Copilot CLI's home dir (used by all install scripts to find/install the extension) |
| `WORK_TRACKER_DIR` | OS app-data dir | Override the data storage directory |
| `WORK_TRACKER_OUTPUT_PATH` | `<data-dir>/work-log.md` | Override the work log output path |
| `BRAG_SHEET_DEBUG` | _(unset)_ | Set to `1` to log extension load events to stderr (useful for verifying the extension is hooked up) |

### config.json (optional)

Place a `config.json` in your data directory to customize:

```json
{
  "preset": "microsoft",
  "categories": [
    { "id": "deployment", "emoji": "🚢", "label": "Deployments" }
  ],
  "output": {
    "includeSessionLog": true
  },
  "git": {
    "enabled": true,
    "push": false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `categories` | array | Custom categories **added** to the built-in set |
| `output.includeSessionLog` | boolean | Include raw session activity table in work log |
| `output.defaultFormat` | string | Output format for entries (default: `"bullets"`) |
| `git.enabled` | boolean | Enable local git history for data directory |
| `git.push` | boolean | Auto-push to a remote git repo |
| `preset` | string | Preset profile — currently `"microsoft"` (see below) |

### Built-in Categories

| ID | Emoji | Label |
|----|-------|-------|
| `pr` | 🚀 | PRs & Features |
| `bugfix` | 🐛 | Bug Fixes |
| `infrastructure` | 🏗️ | Infrastructure |
| `investigation` | 🔍 | Investigation |
| `collaboration` | 🤝 | Collaboration |
| `tooling` | 🔧 | Tooling & DX |
| `oncall` | 🚨 | On-Call |
| `design` | 📐 | Design |
| `documentation` | 📝 | Documentation |

## Tool Reference

### save_to_brag_sheet

Save a work entry to your impact log.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `summary` | string | ✅ | Impact-first summary: "Did X for Y → Result Z" |
| `category` | string | | One of the built-in or custom category IDs |
| `impact` | string | | Who/what benefited and how |
| `tags` | string[] | | Tags for filtering |
| `repo` | string | | Repository name (auto-detected if omitted) |
| `branch` | string | | Branch name (auto-detected if omitted) |

### review_brag_sheet

Review recent entries from your work impact log.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `weeks` | number | | Number of recent weeks to show (default: 4) |

### generate_work_log

Generate a complete work log Markdown file from all records.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `outputPath` | string | | Output file path (defaults to data dir) |

## Backfill Your History

Already been coding for months? Use Copilot CLI to retroactively scan your history and populate your work log:

```
Scan my git log since January and log the significant work to my brag sheet.
```

```
Review my merged GitHub PRs since December and save the impactful ones.
```

The extension doesn't do the scanning — **Copilot CLI is the backfill tool**. The extension just stores whatever it produces. See the full **[Backfill Guide](docs/backfill-guide.md)** for source-by-source instructions covering Copilot sessions, VS Code Chat, ADO PRs, GitHub PRs, git commits, ICM incidents, and Teams/M365.

## Microsoft Employees (Connect / Performance Reviews)

If you're at Microsoft, a one-line preset gives you Connect-optimized framing:

```json
{ "preset": "microsoft" }
```

Or just answer "y" during installation — the install script sets it up for you.

**What changes:**
- The AI frames entries using business impact language ("Did X → Result Y → Evidence Z")
- `review_brag_sheet` output is labeled for Connect review
- The AI knows about Microsoft internal tools (ADO, ICM, Kusto, Teams)
- Session activity log is included by default

**What doesn't change:**
- All data stays local — nothing is sent anywhere
- The same tools work the same way
- Non-Microsoft users get the same experience, just without the Connect framing

## Cloud Sync

Point your data directory to a synced folder and your work log follows you across machines:

```bash
# OneDrive
export WORK_TRACKER_DIR="$HOME/OneDrive/Documents/work-tracker"

# Dropbox
export WORK_TRACKER_DIR="$HOME/Dropbox/work-tracker"

# iCloud
export WORK_TRACKER_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/work-tracker"
```

Atomic writes (tmp → fsync → rename) prevent corruption from sync conflicts.

## Update

Re-run the install script to update to the latest version:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/microsoft/copilot-brag-sheet/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/microsoft/copilot-brag-sheet/main/install.ps1 | iex
```

Or if you cloned the repo:

```bash
cd copilot-brag-sheet && git pull && ./install.sh
```

Your config and data are never touched — only the extension files are replaced.

## Uninstall

```bash
# macOS / Linux
rm -rf ~/.copilot/extensions/copilot-brag-sheet

# Windows (PowerShell)
Remove-Item "$env:USERPROFILE\.copilot\extensions\copilot-brag-sheet" -Recurse -Force
```

Your data stays in the OS app-data directory — delete it manually if you want a full removal.

## FAQ

<details>
<summary><strong>Does this send my data anywhere?</strong></summary>

No. All data is stored locally in your OS app-data directory. Zero telemetry, zero network calls. The core library has no runtime dependencies; the cross-engine MCP server (`mcp-server.mjs`) uses the official MCP SDK and Zod. If you enable git push, data goes only to a remote you configure.
</details>

<details>
<summary><strong>Where is my data stored?</strong></summary>

| OS | Path |
|----|------|
| Windows | `%LOCALAPPDATA%\copilot-brag-sheet\` |
| macOS | `~/Library/Application Support/copilot-brag-sheet/` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/copilot-brag-sheet/` |

Override with `WORK_TRACKER_DIR` environment variable.
</details>

<details>
<summary><strong>Why don't I see "Work logger active"?</strong></summary>

The message appears on your **first message** after starting Copilot CLI (not immediately on `/clear`). Type anything and it should appear. If it doesn't, check that the extension is installed at `~/.copilot/extensions/copilot-brag-sheet/extension.mjs`.
</details>

<details>
<summary><strong>Can I use copilot plugin install?</strong></summary>

No. `copilot plugin install` only loads declarative plugins (skills, agents, MCP). This extension uses `joinSession()` which requires files in `~/.copilot/extensions/`. Use the install scripts instead.
</details>

<details>
<summary><strong>How do I move data between machines?</strong></summary>

Enable git backup in your config, add a remote repo, and your entries sync automatically. Or point `WORK_TRACKER_DIR` to a cloud-synced folder (OneDrive, Dropbox, iCloud).
</details>

## Requirements

- Node.js 18+
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli)
- Local-first: data stays on your machine, no telemetry

## Development

```bash
git clone https://github.com/microsoft/copilot-brag-sheet.git
cd copilot-brag-sheet
npm test        # 107 tests, ~1s
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

[MIT](LICENSE) © Microsoft Corporation

# Copilot Brag Sheet

> Never lose track of what you shipped — auto-log every AI coding session.

A [**brag sheet**](https://jvns.ca/blog/brag-documents/) is a running record of your accomplishments — so when review season arrives, you have receipts, not a blank page. This extension builds yours automatically.

[![CI](https://img.shields.io/github/actions/workflow/status/microsoft/copilot-brag-sheet/ci.yml?branch=main&label=CI)](https://github.com/microsoft/copilot-brag-sheet/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/copilot-brag-sheet.svg)](https://www.npmjs.com/package/copilot-brag-sheet)
[![npm downloads](https://img.shields.io/npm/dm/copilot-brag-sheet.svg)](https://www.npmjs.com/package/copilot-brag-sheet)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Awesome Copilot](https://img.shields.io/badge/Awesome-Copilot-blue?logo=github)](https://github.com/github/awesome-copilot)

## Why

Most developers can't remember what they shipped last week, let alone last quarter. This [Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) extension silently records your work as you go — files edited, PRs created, git actions — so when it's time for a performance review, you have a complete, impact-framed log.

**Zero dependencies. Local-first. Cross-platform.**

> **Requires:** Node.js 18+, [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) (with active Copilot subscription)

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

## Quick Start

### 1. Install

**One-liner:**

```bash
# macOS / Linux
curl -sL https://raw.githubusercontent.com/microsoft/copilot-brag-sheet/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/microsoft/copilot-brag-sheet/main/install.ps1 | iex
```

**Or clone and install (includes interactive setup wizard):**

```bash
git clone https://github.com/microsoft/copilot-brag-sheet.git
cd copilot-brag-sheet
./install.sh          # macOS/Linux
# .\install.ps1       # Windows
```

The setup wizard will ask a few optional questions (Microsoft preset, git history, remote sync). You can re-run it anytime:

```bash
node ~/.copilot/extensions/copilot-brag-sheet/bin/setup.mjs
```

After installing, run `/clear` in the Copilot CLI or restart it to load the extension.

### 2. Use

Start a Copilot CLI session — the extension loads automatically:

```
📊 Work logger active
```

That's it. Sessions are tracked in the background. When you want to log notable work:

```
You: "brag — shipped the auth refactor"
Agent: [calls save_to_brag_sheet with summary, category, impact]
```

Or review your recent work:

```
You: "show me my recent work"
Agent: [calls review_brag_sheet]
```

### 3. Generate a work log

```
You: "generate my work log"
Agent: [calls generate_work_log → writes work-log.md]
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

## How It Works

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

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORK_TRACKER_DIR` | OS app-data dir | Override the data storage directory |
| `WORK_TRACKER_OUTPUT_PATH` | `<data-dir>/work-log.md` | Override the work log output path |

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
curl -sL https://raw.githubusercontent.com/microsoft/copilot-brag-sheet/main/install.sh | bash

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

No. All data is stored locally in your OS app-data directory. Zero telemetry, zero network calls. The extension has zero runtime dependencies. If you enable git push, data goes only to a remote you configure.
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

The message appears on your first interaction in a session (not on `/clear`). Type anything and it should appear. If it doesn't, check that the extension is installed at `~/.copilot/extensions/copilot-brag-sheet/extension.mjs`.
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
- Zero runtime dependencies

## Development

```bash
git clone https://github.com/microsoft/copilot-brag-sheet.git
cd copilot-brag-sheet
npm test        # 107 tests, ~1s
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

[MIT](LICENSE) © Microsoft Corporation

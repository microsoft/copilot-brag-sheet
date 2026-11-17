# Copilot Brag Sheet

Keep a record of your work so you do not have to reconstruct it at review time.

Copilot Brag Sheet records activity during your
[GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli)
sessions. When you finish something worth remembering, add a short note about
the result and a link to the evidence. Later, ask Copilot to review those notes
or turn them into a work log.

Records stay in local files. The plugin has no telemetry; your AI host still
processes the content you ask it to review.

[![CI](https://img.shields.io/github/actions/workflow/status/microsoft/copilot-brag-sheet/ci.yml?branch=main&label=CI)](https://github.com/microsoft/copilot-brag-sheet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Awesome Copilot](https://img.shields.io/badge/Awesome-Copilot-blue?logo=github)](https://github.com/github/awesome-copilot)

[Install](#install) · [Example](#a-real-example) · [Quickstart](docs/quickstart.md) · [Website](https://microsoft.github.io/copilot-brag-sheet/)

> **Requires:** Node.js 22+, [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) (with active Copilot subscription)

## What it does

- **Records activity while the extension is running:** repository, branch,
  files changed, recognized PR/git actions, and session context.
- **Saves accomplishments you choose:** what changed, why it mattered, and
  the evidence you provide.
- **Makes those notes easier to reuse:** review recent entries or generate
  a Markdown work log for a weekly update or performance-review draft.

It is most useful if you work regularly in Copilot CLI and add a short note
when a result is fresh. It does not automatically track work in other apps,
measure business impact, or write your review for you.

The agent uses three tools:

| Tool | What it does |
|------|-------------|
| `save_to_brag_sheet` | Save a work accomplishment to your impact log |
| `review_brag_sheet` | Review recent entries for performance discussions |
| `generate_work_log` | Render all records into a Markdown file |

The included [skill](skills/brag-sheet/SKILL.md) guides the conversation.
The native extension handles capture and storage. The skill alone does not
provide that background capture.

## A real example

This project's [marketplace installation change (#72)](https://github.com/microsoft/copilot-brag-sheet/pull/72)
is an example of work worth keeping a note about. The PR added a GitHub install
path and fixed duplicate component startup.

A concise review note based on that public PR:

> Added GitHub marketplace installation and updates for Copilot Brag Sheet,
> so users can install the native extension without npm. Fixed duplicate
> server startup and verified that an update preserved saved records.
> Evidence: [#72](https://github.com/microsoft/copilot-brag-sheet/pull/72).

That is more useful than "worked on plugin packaging." It says what changed
and provides a source, without inventing time savings or adoption numbers.
When writing your own note, distinguish your contribution from the team's work.

### Runtime compatibility

| Runtime | Manual tools | Auto-tracking | Status |
|---------|-------------|---------------|--------|
| **Copilot CLI** | ✅ Full | ✅ Full | Experimental extension API |
| **MCP hosts** (Claude, Cursor, VS Code) | ✅ Full | ⚠️ Phase 2 | Beta |

**MCP users:** The three tools (`save_to_brag_sheet`, `review_brag_sheet`, `generate_work_log`) work fully. Automatic session tracking (files edited, PRs created, git actions) requires the Copilot CLI `joinSession()` runtime and is not provided by the standalone MCP server. Say `"brag — <accomplishment>"` to capture work manually.

**Copilot CLI users:** Automatic tracking requires experimental features to be
enabled and the extension's hooks to be approved. The underlying `joinSession()`
API is experimental; support can vary by CLI version and launch mode.
Check that session records and capture counters appear before relying on a
work log as complete. MCP tools remain available for explicit saves.

## Install

Use a current Copilot CLI with
[plugin extension support](https://docs.github.com/en/copilot/tutorials/create-an-extension).
The plugin uses the SDK supplied by the CLI: no npm install or hosted service is
needed for automatic capture.

| Install path | What it installs |
|---|---|
| GitHub marketplace (recommended) | Current `main`, including the recent capture and installation fixes |
| Downloaded Bash / PowerShell installer | Current `main` as a legacy user extension |
| npm | Latest published release as a legacy user extension |

Use the marketplace for a new installation. Choose one path, not several.

### Recommended: GitHub-backed plugin

```shell
copilot plugin marketplace add microsoft/copilot-brag-sheet
copilot plugin install copilot-brag-sheet@brag-sheet
copilot config experimental on
copilot
```

The third command enables experimental features once for the selected Copilot
profile; it is not limited to this plugin. Follow your organization's policy.
Future sessions can start with just `copilot`. If you prefer not to persist
that setting, omit the third command and use `copilot --experimental` for each
session instead. The legacy native extension also requires experimental features.

Approve the extension's hooks when prompted. In the session, open
`/extensions manage` and confirm `copilot-brag-sheet` is running.

**Upgrading from the old installer?** First close your CLI sessions and move
`copilot-brag-sheet` out of your Copilot home's `extensions` directory. Keep
that copy as a fallback, but do not load both installations at once. Your
records live in a separate app-data directory; leave them in place.
`COPILOT_HOME`, when set, selects the CLI profile to install into.

### Alternative: one-liner

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/microsoft/copilot-brag-sheet/main/install.sh | bash

# Windows (PowerShell 5.1+)
irm https://raw.githubusercontent.com/microsoft/copilot-brag-sheet/main/install.ps1 | iex
```

These scripts fetch the default branch when run outside a source checkout.
From a checkout, they install that checkout's files. The setup wizard runs
when an interactive terminal is available.

### Alternative: from npm

Use npm for versioned releases. The marketplace follows `main`, which can
include changes not yet published to npm. Both use the native Copilot adapter.

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

After install, start `copilot` if experimental features are already enabled for
that profile, or `copilot --experimental` for a single session. Approve its hooks when prompted.
On your first message you'll see:

```
📊 Work logger active
```

The plugin works with default settings without running setup. To customize it,
edit `config.json` in your [data directory](#configuration).
For legacy installs, re-run setup with `copilot-brag-sheet-setup` (npm) or
`node ~/.copilot/extensions/copilot-brag-sheet/bin/setup.mjs` (install script).

> Install failing? [Open an issue](https://github.com/microsoft/copilot-brag-sheet/issues/new) with the error — Windows + macOS + Linux are CI-tested.

### Update or remove

```shell
copilot plugin marketplace update brag-sheet
copilot plugin update copilot-brag-sheet@brag-sheet
```

Start a new CLI session after updating. To remove the plugin, use
`copilot plugin uninstall copilot-brag-sheet@brag-sheet`. Updating or uninstalling the
plugin does not remove the separate work-history directory.

For a local checkout, register that directory as the marketplace instead:
`copilot plugin marketplace add .`. Local marketplace plugins load directly from
the checkout; edits take effect in a new session without an update command.

### Verify before relying on it

In a disposable project, ask Copilot to create a small file, then ask:

> Read the current session's JSON record in the work logger's data directory.
> Show filesCreated, filesEdited, and the capture counters. Confirm the file just
> created is recorded. If no session evidence is available, say so.

The active banner confirms startup, not complete capture. Check the actual
session evidence. See the [quickstart and demo](docs/quickstart.md) for a
five-minute walkthrough from captured work to a review draft.

## Use

### Save the result, not just the activity

When you finish meaningful work, say "brag" and provide the result, your role,
and a permitted source link. If you have not measured the outcome, say so.
The agent should not add metrics you did not supply.

### Review your notes

```
Show me my saved work from the last two weeks.
```

For a draft:

```
Generate my work log. Then draft a short review from my saved entries.
Group related work, cite the sources, and flag anything missing.
Keep my contribution separate from team outcomes. Do not invent metrics.
```

The work log is generated from stored records; the AI host writes the draft.
Read it before sharing. Automatic session activity is optional in the log
and is not a substitute for saved accomplishments.

## Examples

<details>
<summary><strong>What a session record looks like</strong> (auto-captured JSON)</summary>

The extension records active-session data in this shape. This is an
illustrative record, not a real user's history:

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "type": "session",
  "extensionVersion": "1.2.0",
  "timestamp": "2025-04-14T14:30:00.000Z",
  "endTime": "2025-04-14T15:45:00.000Z",
  "endReason": "complete",
  "repo": "copilot-brag-sheet",
  "branch": "main",
  "cwd": "/home/user/repos/copilot-brag-sheet",
  "filesEdited": ["lib/config.mjs", "test/config.test.mjs"],
  "filesCreated": ["docs/backfill-guide.md"],
  "prsCreated": [],
  "significantActions": ["git commit", "git push"],
  "taskDescription": "Add a configuration option",
  "status": "finalized",
  "capture": {
    "promptCount": 2,
    "successfulToolCount": 8,
    "failedToolCount": 1,
    "errorCount": 0,
    "recognizedToolCount": 4,
    "compactionCount": 0,
    "resumeCount": 0,
    "summarySource": "finalMessage"
  }
}
```

You don't write these — they're captured automatically in the background.

</details>

### What a brag sheet entry looks like

For the [public example above](#a-real-example), selected entry fields could be:

```json
{
  "type": "entry",
  "summary": "Added GitHub marketplace installation and updates",
  "category": "tooling",
  "impact": "Native installation no longer requires npm. Evidence: https://github.com/microsoft/copilot-brag-sheet/pull/72",
  "repo": "copilot-brag-sheet",
  "branch": "main"
}
```

### What the generated work log looks like

The corresponding work-log excerpt:

```markdown
# Work Impact Log

## Week of 2026-11-02

### 🔧 Tooling & DX
- **[copilot-brag-sheet] Added GitHub marketplace installation and updates** — Native installation no longer requires npm. Evidence: https://github.com/microsoft/copilot-brag-sheet/pull/72
```

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
active ──► finalized        (normal completion or user exit)
active ──► incomplete       (error, abort, or timeout)
active ──► emergency-saved  (process shutdown)
active ──► orphaned         (recovered after an unobserved process exit)
  ▲
  └──────── resume          (same record and evidence are reused)
```

Recent-work reviews and session-log grouping use the session's latest observed
activity, while `timestamp` remains its original start time. A resumed session
appears once with its accumulated evidence; this is not a per-event timeline.
Manual entries continue to use their creation time.

If the host terminates the extension without delivering an end event, the
extension attempts a synchronous emergency save on transport closure or
catchable process exit. Hard termination (including Windows force termination)
cannot run these handlers: incremental evidence remains on disk, and a later
session marks stale records with dead process IDs as `orphaned`.

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
  "categories": [
    { "id": "deployment", "emoji": "🚢", "label": "Deployments" }
  ],
  "output": {
    "includeSessionLog": true
  },
  "nudges": {
    "prCreated": false
  },
  "git": {
    "enabled": false,
    "push": false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `categories` | array | Custom categories **added** to the built-in set |
| `output.includeSessionLog` | boolean | Include raw session activity table in work log |
| `output.defaultFormat` | string | Output format for entries (default: `"bullets"`) |
| `nudges.prCreated` | boolean | Opt in to PR contribution draft suggestions in the native Copilot extension (default: `false`) |
| `git.enabled` | boolean | Enable local git history for data directory |
| `git.push` | boolean | Auto-push to a remote git repo |
| `preset` | string | Optional context preset; currently `"microsoft"`. It does not connect to other services. |

### Optional PR contribution drafts

Set `"nudges": { "prCreated": true }` in your data directory's `config.json`,
then start a new Copilot CLI session with the extension enabled. After a
supported PR-creation tool succeeds, the extension asks the host to offer a
brief contribution draft with its PR link and **Save / Edit / Skip** choices.
The draft must not treat opening a PR as proof of shipping or measured impact.
Accept the draft to save it; editing alone, skipping, or silence does not save
a contribution entry.

This first version recognizes synchronous `create_pull_request` tools that
return a JSON object with a matching GitHub.com PR URL. Existing session capture
must also recognize the PR: a title in the tool arguments or a PR number in the
result. It does not recognize
shell commands such as `gh pr create`, asynchronous PR jobs, GitHub Enterprise,
or PRs opened outside the session. MCP-only installations do not provide this
hook.

The extension sends guidance at most once per session, including resumes.
The host decides how to present it and may omit it; these are conversational
choices, not buttons or an enforceable approval dialog. Normal automatic session
capture and optional backup are unchanged. Retrying an accepted draft uses the
same source key to avoid duplicates; it does not edit an already saved entry.

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
| `idempotencyKey` / `idempotency_key` | string | | Stable source ID for retry-safe saves (camelCase in the extension, snake_case over MCP) |

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

Backfill is an explicit task for your AI host, not background collection by
the extension. Agree on the sources, date range, and proposed entries before
saving. Use only sources your account and host are approved to access.

## Cloud Sync

If your data-handling rules permit it, point your data directory to an approved
synced folder. For example:

```bash
# OneDrive
export WORK_TRACKER_DIR="$HOME/OneDrive/Documents/work-tracker"

# Dropbox
export WORK_TRACKER_DIR="$HOME/Dropbox/work-tracker"

# iCloud
export WORK_TRACKER_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/work-tracker"
```

Atomic writes protect against interrupted local writes, not cloud-sync
conflicts. Avoid simultaneous writers across machines and keep backups.

## Update a legacy installation

For marketplace installations, use [plugin updates](#update-or-remove).
For a legacy installation, close Copilot before re-running the installer:

If you installed with npm, update the package **and** copy it into your
Copilot profile again:

```bash
npm install -g copilot-brag-sheet@latest
copilot-brag-sheet
```

Updating the global npm package alone does not update the installed extension.
Restart Copilot after the installer finishes.

If you used a downloaded script:

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

The installer replaces extension files; records are stored separately.
The setup wizard can change configuration if you choose new settings.
Keep a fallback copy before updating: script-based installation is not an
atomic upgrade and can fail after removing the previous extension files.

## Uninstall a legacy installation

For a marketplace install, use `copilot plugin uninstall copilot-brag-sheet@brag-sheet`.
The commands below apply only to legacy installs in the default Copilot home.
If you set `COPILOT_HOME`, use that home instead.

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

The plugin stores records locally and emits no telemetry. Reviewing records
returns their content to your AI host, so that processing is not necessarily
local. Optional git push sends data to the remote you configure. Keep backup
off unless the destination is approved, and keep secrets out of entries:
formatting sanitization is not secret redaction.
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

The message appears on your **first message** after starting Copilot CLI.
Confirm experimental features are enabled (once with `copilot config experimental on`,
or for this launch with `copilot --experimental`) and approve the extension's hooks.
For a plugin install, check `copilot plugin list` and `/extensions manage`.
For a legacy install, check your Copilot home's
`extensions/copilot-brag-sheet/extension.mjs`. Use only one installation.
Then [verify the saved session evidence](#verify-before-relying-on-it);
the banner alone does not prove complete capture.
</details>

<details>
<summary><strong>Can I use copilot plugin install?</strong></summary>

Yes. A current Copilot CLI supports the native extension through the
[GitHub-backed marketplace](#recommended-github-backed-plugin).
Enable experimental features and approve its hooks. If migrating from the
legacy installer, move the old extension out of your Copilot home first;
keep your work-history directory intact.
</details>

<details>
<summary><strong>How do I move data between machines?</strong></summary>

Use an approved backup or synced folder, and set `WORK_TRACKER_DIR` to the data
location on the new machine. Optional git backup excludes session records;
it is not a complete copy of your history. Keep a backup before moving data,
and avoid concurrent writes from multiple machines.
</details>

## Requirements

- Node.js 22+
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli)
- A host/account approved for the information you process

## Development

```bash
git clone https://github.com/microsoft/copilot-brag-sheet.git
cd copilot-brag-sheet
npm install
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

[MIT](LICENSE) © Microsoft Corporation

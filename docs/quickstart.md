# Keep work notes you can use later

The extension remembers activity from your CLI sessions. Your notes explain
what that work achieved. You can review them during the week or use them as
source material when writing a performance review.

## Set up once

Install the [GitHub-backed plugin](../README.md#recommended-github-backed-plugin),
enable experimental features once with `copilot config experimental on`, then
start `copilot` and approve the extension's hooks. This setting applies to the
selected Copilot profile and enables experimental features generally, not just
this plugin. Follow your organization's policy. For a session-only opt-in,
use `copilot --experimental` instead of changing the setting. Check
`/extensions manage` before relying on capture. Use only one installation:
the plugin or the older extension installer, not both.

No account, hosted service, or git backup is required by this plugin. Your host
still requires its own authentication. Records use your OS app-data directory
unless you explicitly set `WORK_TRACKER_DIR`.
Use the GitHub marketplace for current code. The npm package remains an older
v1.2.0 release and does not include the recent fixes on `main`.

### Ask Copilot to help install

You can give your existing Copilot session this prompt:

> Install the copilot-brag-sheet plugin from microsoft/copilot-brag-sheet into
> the Copilot profile used by this session. Confirm the active COPILOT_HOME
> (or default home), inspect installed plugins and legacy extensions, and stop
> if there is a conflicting copy. Register the marketplace with
> `copilot plugin marketplace add microsoft/copilot-brag-sheet` and install
> `copilot-brag-sheet@brag-sheet`, skipping steps already completed. Verify the
> installed path and enabled status. If experimental features are disabled,
> explain the profile-wide setting and ask before enabling it. Leave existing
> records, other plugins, and authentication unchanged. Never print credentials.
> If access is blocked, report the error rather than changing credentials or
> bypassing policy. Tell me how to restart and check the extension.

Review tool-permission requests before approving them. Installation is not
capture verification: restart into the same profile, check `/extensions manage`,
and run the synthetic demo below.

## Save a useful note

Automatic capture records activity: files changed, recognized git/PR actions,
session context, and capture counters. It is a memory aid, not proof that a
change shipped or improved a business outcome.

When you finish meaningful work, add what changed, your contribution, the
observed result, and an evidence link. You can ask:

> Save a note about the change we just finished. Ask me for the outcome and a
> source link if they are missing. Show me the proposed entry before saving.

A useful note can cover a bug fix, a decision, an investigation, or help you
gave a teammate. It does not need a percentage improvement. If the result is
not known yet, say so. See the [example from this project's public work](../README.md#a-real-example).

## Five-minute demo

This is an optional installation check, not an example of real impact. It
tests whether capture, saving, and log generation work in your profile.
Use a disposable project and a separate data directory. In a separate PowerShell
window using the same Copilot profile:

```powershell
$demo = Join-Path $env:TEMP ("brag-demo-" + [guid]::NewGuid())
$env:WORK_TRACKER_DIR = Join-Path $demo 'data'
$env:WORK_TRACKER_OUTPUT_PATH = Join-Path $env:WORK_TRACKER_DIR 'work-log.md'
$env:WORK_TRACKER_GIT_BACKUP = 'false'
$env:WORK_TRACKER_GIT_PUSH = 'false'
New-Item -ItemType Directory -Path $env:WORK_TRACKER_DIR | Out-Null
New-Item -ItemType Directory -Path (Join-Path $demo 'workspace') | Out-Null
'{"git":{"enabled":false,"push":false},"output":{"includeSessionLog":true}}' |
  Set-Content -Encoding ascii (Join-Path $env:WORK_TRACKER_DIR 'config.json')
Write-Output $env:WORK_TRACKER_DIR
Set-Location (Join-Path $demo 'workspace')
copilot
```

This override applies only to this shell and its child processes. It does not
move or import existing records. Use synthetic content throughout the demo.
If you chose session-only activation above, launch with `copilot --experimental`
instead.

1. Ask: **"Create demo-evidence.txt containing 'Synthetic demo: startup benchmark,
   before 10 minutes, after 6 minutes'. This is demonstration data, not a real
   achievement."** Let Copilot make the edit.
2. Ask: **"Read the current session JSON in the demo data directory. Confirm
   demo-evidence.txt appears in filesCreated or filesEdited, and show the capture
   counters. Do not save an accomplishment yet."**
3. Ask: **"Save this synthetic demo accomplishment: improved fixture startup.
   Category: tooling. Impact: synthetic benchmark decreased from 10 to 6 minutes.
   Evidence: demo-evidence.txt. Tag it demo."**
4. Ask: **"Generate my work log. Then draft a short performance-review paragraph
   using only the saved demo entry. Keep the synthetic label, cite the evidence,
   and do not invent customers, delivery status, or additional metrics."**

Confirm that a session record contains the edited file, the saved entry contains
the supplied impact and evidence, and the generated Markdown includes the entry
and session-activity summary.
Do not accept a fluent answer as proof that a save succeeded.

After exiting the CLI, close the test shell. This leaves your normal shell's
data-directory settings unchanged. The demo records remain in the printed location.
Never delete your normal data directory as demo cleanup.

## During real work

Say "brag" when there is a meaningful result worth retaining. Include a source
link where permitted. If the result is not yet known, say that explicitly rather
than estimating a benefit. Work outside the active CLI session is not captured
automatically; add it manually or request a separately scoped backfill.

## Before a performance review

Ask:

> Draft a short review from my saved entries for this period. Group related
> work, cite the sources, and flag anything missing. Keep my contribution
> separate from team outcomes. Do not invent metrics. Show me the draft before
> sharing it.

Confirm the date range when prompted. Review the sources, remove sensitive
details, and edit the draft in your own voice before sharing it.

Session rows in review output are optional: enable `output.includeSessionLog`
in your data directory's `config.json` to include them. They show activity
summaries and counts; inspect the corresponding JSON for exact filenames.

## Handle work information carefully

- Use an account and AI host approved for the information you are processing.
  Review tools return saved content to that host; local storage does not make
  subsequent model processing offline.
- Do not put credentials, raw customer data, or unnecessary sensitive details in
  prompts or entries. The plugin sanitizes formatting but does not redact secrets.
- Leave git backup off unless the destination is explicitly approved for that
  information. A private personal repository is not automatically an appropriate
  destination for employer information.
- Inspect generated logs before sharing. Use synthetic records for screenshots
  and demos; keep work records out of public issues and pull requests.

See the [security model](security-model.md) for limitations.

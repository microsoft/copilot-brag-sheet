# From work evidence to a review draft

## Set up once

Install the [GitHub-backed plugin](../README.md#recommended-github-backed-plugin),
start `copilot --experimental`, and approve the extension's hooks. Check
`/extensions manage` before relying on capture. Use only one installation:
the plugin or the older extension installer, not both.

No account, hosted service, or git backup is required by this plugin. Your host
still requires its own authentication. Records use your OS app-data directory
unless you explicitly set `WORK_TRACKER_DIR`.

## Understand what is captured

Automatic capture records activity: files changed, recognized git/PR actions,
session context, and capture counters. It is a memory aid, not proof that a
change shipped or improved a business outcome.

For useful review material, add the missing context when you finish meaningful
work: what changed, who benefited, the observed result, and an evidence link.
Use the `brag-sheet` skill when preparing a draft. Do not turn every file edit
into an accomplishment.

## Five-minute demo

Use a disposable project and a separate data directory. In PowerShell:

```powershell
$env:WORK_TRACKER_DIR = Join-Path $env:TEMP ("brag-demo-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $env:WORK_TRACKER_DIR | Out-Null
'{"git":{"enabled":false,"push":false},"output":{"includeSessionLog":true}}' |
  Set-Content -Encoding ascii (Join-Path $env:WORK_TRACKER_DIR 'config.json')
Write-Output $env:WORK_TRACKER_DIR
copilot --experimental
```

This override applies only to this shell and its child processes. It does not
move or import existing records. Use synthetic content throughout the demo.

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

After exiting the CLI, remove the demo override:

```powershell
Remove-Item Env:WORK_TRACKER_DIR
```

The demo records remain in the printed data location until you remove them.
Never delete your normal data directory as demo cleanup.

## During real work

Say "brag" when there is a meaningful result worth retaining. Include a source
link where permitted. If the result is not yet known, say that explicitly rather
than estimating a benefit. Work outside the active CLI session is not captured
automatically; add it manually or request a separately scoped backfill.

## Before a performance review

Ask:

> Use my saved brag-sheet records for the agreed review period. Group related
> work into impact themes. Separate my contributions from team outcomes, cite
> supporting entries or source links, and flag missing evidence. Do not infer
> business impact from file counts or invent metrics. Show me the draft before
> saving or sharing anything.

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

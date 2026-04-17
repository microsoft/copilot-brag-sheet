# Backfill Your Work History

> **Key insight:** Copilot CLI *is* the backfill tool. This extension just stores whatever it produces. You tell the AI what to look at, it does the research, and `save_to_brag_sheet` records the results.

Already been coding for months without a work tracker? No problem. Open a Copilot CLI session and ask it to scan your history from any of these sources.

---

## From Copilot CLI Session History

Your past Copilot CLI sessions are stored locally. Ask the agent to scan them:

```
Scan my copilot session history since January and log the highlights to my brag sheet.
Sessions are in ~/.copilot/session-state/
```

```
Review my recent copilot sessions from the last 3 months.
Summarize the most impactful ones and save them with save_to_brag_sheet.
```

**Where sessions live:**
| OS | Path |
|----|------|
| Windows | `%USERPROFILE%\.copilot\session-state\` |
| macOS | `~/.copilot/session-state/` |
| Linux | `~/.copilot/session-state/` |

---

## From VS Code Copilot Chat History

VS Code stores chat sessions locally. Point the agent at them:

```
Scan my VS Code Copilot chat history and log significant coding sessions.
Chat sessions are in the VS Code workspace storage.
```

**Where VS Code chat sessions live:**
| OS | Path |
|----|------|
| Windows | `%APPDATA%\Code\User\workspaceStorage\*\chatSessions\` |
| macOS | `~/Library/Application Support/Code/User/workspaceStorage/*/chatSessions/` |
| Linux | `~/.config/Code/User/workspaceStorage/*/chatSessions/` |

---

## From Azure DevOps PRs

If you have the ADO MCP server connected, the agent can pull your completed PRs:

```
Pull my completed ADO PRs since January and log the impactful ones.
Use save_to_brag_sheet with category "pr" for each.
```

```
Review my ADO pull requests across all projects since October.
Focus on ones that shipped features or fixed production issues.
```

---

## From GitHub PRs

With the GitHub MCP server, scan your merged PRs:

```
Review my merged GitHub PRs since December across all my repos.
Log the significant ones to my brag sheet.
```

```
Find PRs I authored in microsoft/copilot-brag-sheet and log them.
```

---

## From Git Commit History

Point the agent at your local repos:

```
Scan git log in this repo since October and identify significant commits.
Group related commits into work items and save to my brag sheet.
```

```
Review git history across ~/repos/*/  since January.
Focus on feature branches that were merged to main.
```

---

## From ICM / Incident History (Microsoft-internal)

> These prompts require the ICM MCP server, available to Microsoft employees.

If you have the ICM MCP server connected:

```
Check my ICM incident history since November.
Log incident responses where I was the primary responder using category "oncall".
```

```
Find ICM incidents I mitigated in the last quarter and log them as on-call wins.
```

---

## From Teams / Microsoft 365 (Microsoft-internal)

> These prompts require the WorkIQ skill or M365 Copilot, available to Microsoft employees.

With the WorkIQ skill or M365 Copilot:

```
Find announcements I posted in Teams channels since December.
Log significant ones like shipped features or team updates.
```

```
Search my sent emails for project updates I shared since January.
Summarize the key accomplishments mentioned.
```

---

## Tips for Effective Backfilling

1. **Go source by source** — don't try to scan everything at once. Start with PRs (most concrete), then git history, then sessions.

2. **Let the AI summarize** — don't write the entries yourself. Say "summarize and save" and let the agent call `save_to_brag_sheet` with proper impact framing.

3. **Use categories** — tell the agent which category to use: `pr`, `bugfix`, `infrastructure`, `oncall`, etc.

4. **Review after** — run `review_brag_sheet` to see everything in one place. Edit or re-save entries that need refinement.

5. **You can always re-summarize later** — the raw data is in JSON records. Use `generate_work_log` or `review_brag_sheet` anytime to re-render with fresh context.

---

## Philosophy

> Track work in the best way possible — you can always summarize later using AI.

This extension captures the raw signal (sessions, files, PRs, actions). The backfill guide helps you retroactively add signal you generated before installing the tracker. Either way, when it's time for a performance review or manager sync, the AI has rich context to help you write compelling impact statements.

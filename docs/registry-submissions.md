# Registry submissions tracker

Discoverability outreach for `skills/brag-sheet/SKILL.md`. Goal: maximize inbound links from Claude Code / agent-skill / Copilot CLI catalogs.

Last updated: 2026-05-03

## Submissions

### ✅ Submitted

| Registry | Stars | Status | Link | Notes |
|---|---|---|---|---|
| [BehiSecc/awesome-claude-skills](https://github.com/BehiSecc/awesome-claude-skills) | 8.9k | PR open | [#283](https://github.com/BehiSecc/awesome-claude-skills/pull/283) | Added under "Collaboration & Project Management". Active maintainer (last merge Mar 2026). |

### 🌐 Discoverable (auto-crawl, no submission process)

| Registry | URL | Notes |
|---|---|---|
| Glama | https://glama.ai/ | MCP server marketplace. Re-evaluate after we ship `mcp-server.mjs` (todo `p1-mcp-server`). Currently irrelevant — we don't have an MCP server. |
| Smithery | https://smithery.ai/ | Same as Glama — MCP-only. Re-evaluate after MCP server ships. |
| GitHub Topics | https://github.com/topics/agent-skill | Repo now tagged `agent-skill`, `claude-code`, `copilot-cli`, `mcp`, `brag-sheet`, `work-tracker`, `performance-review`, `developer-tools`, `developer-productivity`, `copilot-extension`, `copilot`, `github-copilot`, `local-first`, `impact-log`, `productivity`. |
| claudskills.com | https://claudskills.com/ | Already passively indexed (scraped without attribution). Attribution reclaim is a separate workstream — see todo `p1-claudskills-attribution` (done). |

### ⏭ Deliberately skipped (with reason)

| Registry | Reason for skipping |
|---|---|
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) (42k★, active) | **Submission policy explicitly bans `gh` CLI / programmatic submission.** From their `recommend-resource.yml` template: *"Issues must be submitted by human users using the github.com UI. The system does not allow resource submissions via the `gh` CLI or other programmatic means. Doing so violates the Code of Conduct and submissions will be automatically closed."* Needs to be filed manually in a browser. **Action item for human:** open https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml and fill in the form by hand. Repo URL: `microsoft/copilot-brag-sheet`. Suggested category: "Workflows" or similar. |
| [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) (12k★) | Two hard blockers: (1) requires ≥10 GitHub stars on the submitted project — we have 4; auto-closed below threshold. (2) explicitly bans AI-assisted PRs. Revisit once we cross 10 stars AND a human is available to file the PR by hand. |
| [anthropics/skills](https://github.com/anthropics/skills) (127k★) | Official Anthropic example-skills repo. **Not actually a community catalog**: 1088 open PRs, 1087 open issues, no CONTRIBUTING.md, no issue templates, no triage signal that community submissions get reviewed. Filing here would be noise with near-zero merge probability. The repo functions as Anthropic's curated showcase, not a public registry. |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) (57k★ — likely inflated) | Each entry is a full skill folder hosted in their repo, not external links. Would require donating the entire skill source to Composio's repo. Out of scope. |
| [ComposioHQ/awesome-claude-plugins](https://github.com/ComposioHQ/awesome-claude-plugins) | Plugin-only registry. We're not yet a Claude Code plugin (todo `p1-claude-plugin-manifest` is pending). Revisit after plugin manifest ships. |
| [ccplugins/awesome-claude-code-plugins](https://github.com/ccplugins/awesome-claude-code-plugins) | Plugin-only and inactive (no merged PRs in the last 60 days). Revisit if/when both conditions change. |
| [webfuse-com/awesome-claude](https://github.com/webfuse-com/awesome-claude) (1.4k★) | Generic Claude ecosystem list (official courses, IDE extensions, MCP). No clean fit for a third-party SKILL.md. Submitting would be off-topic. |
| [jqueryscript/awesome-claude-code](https://github.com/jqueryscript/awesome-claude-code) (336★) | No merged PRs in last 60 days — appears unmaintained. |
| [LangGPT/awesome-claude-code](https://github.com/LangGPT/awesome-claude-code), [pascalporedda/awesome-claude-code](https://github.com/pascalporedda/awesome-claude-code), [Mizoreww/awesome-claude-code-config](https://github.com/Mizoreww/awesome-claude-code-config), [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) | Either narrow scope (prompts, hooks, configs) or curated by a single team — not a general-purpose registry that solicits external submissions. |
| [wong2/awesome-mcp-servers](https://github.com/wong2/awesome-mcp-servers), [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | MCP-server registries. Revisit after `p1-mcp-server` ships. |

### 🚫 Reserved for launch (do not submit yet)

| Channel | Reason |
|---|---|
| Hacker News (Show HN) | Reserved for blog post launch day. One-shot — don't burn the post. |
| r/ClaudeAI | Same — one-shot launch channel. |
| Twitter/Bluesky | No spammy @-mentions of individuals. Reserved for owned-channel launch. |

## GitHub Topics (microsoft/copilot-brag-sheet)

Updated 2026-05-03 to: `brag-sheet`, `copilot`, `copilot-cli`, `developer-productivity`, `developer-tools`, `github-copilot`, `local-first`, `performance-review`, `work-tracker`, `impact-log`, `agent-skill`, `claude-code`, `copilot-extension`, `mcp`, `productivity`.

`mcp` is intentionally added pre-emptively even though we haven't shipped the MCP server yet (`p1-mcp-server` pending) — drives discoverability for users searching for MCP-adjacent tooling, and we'll ship the server soon.

## What changed in this round

- **1 PR opened** (BehiSecc #283).
- **3 registries** documented as auto-discoverable (claudskills.com already indexed; Glama/Smithery deferred until MCP server ships).
- **15 GitHub topics** set on the repo.
- **6 candidate registries triaged and skipped** with explicit reasons (so future maintainers don't redo the analysis).
- **2 registries flagged for manual browser submission** by a human (hesreallyhim, travisvn once we hit 10 stars).

## Next manual actions for a human operator

1. Open https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml in a browser and submit the brag-sheet skill.
2. Once `microsoft/copilot-brag-sheet` crosses 10 GitHub stars, file a PR to travisvn/awesome-claude-skills (must be hand-typed, not AI-drafted).
3. After `p1-mcp-server` ships, file PRs to wong2/awesome-mcp-servers, punkpeye/awesome-mcp-servers, and check Glama / Smithery listing.

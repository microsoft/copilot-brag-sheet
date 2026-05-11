# MCP Eval Suite — copilot-brag-sheet

This directory holds the 10-question evaluation suite that exercises the
`brag-sheet-mcp-server` MCP server end-to-end against a deterministic fixture.

## Files

| File | Purpose |
| --- | --- |
| `fixtures/entries.json` | 15 brag-sheet entries with relative-day timestamps. Stable summaries / tags / impact / repos so the LLM can locate any entry by exact text. |
| `seed.mjs` | Wipes a target data directory and seeds it with the fixture using the same `writeRecord` path the live server uses. |
| `brag-sheet.eval.xml` | 10 `<qa_pair>` evaluation questions following the MCP protocol's evaluation format: closed-window, independent, complex, single deterministic answer, fixture-derived. |

## Running locally

1. Install deps and verify the server is healthy:
   ```bash
   npm install
   npm test
   ```

2. Seed the fixture into a scratch directory:
   ```bash
   WORK_TRACKER_DIR=$(mktemp -d) node evals/seed.mjs
   ```
   On Windows PowerShell:
   ```powershell
   $env:WORK_TRACKER_DIR = (New-Item -ItemType Directory -Path "$env:TEMP\bs-eval-$(Get-Random)").FullName
   node evals/seed.mjs
   ```

3. Point your MCP eval harness at `evals/brag-sheet.eval.xml`. Make sure it
   spawns the server with the same `WORK_TRACKER_DIR` so the fixture is
   visible:
   ```bash
   WORK_TRACKER_DIR="$WORK_TRACKER_DIR" mcp-eval evals/brag-sheet.eval.xml \
     --server "node $(pwd)/mcp-server.mjs"
   ```

## Fixture timing model

Each fixture entry stores a `daysAgo` field. At seed time we compute
`timestamp = now - daysAgo * 86400000` so the dataset's relative recency is
identical regardless of when the suite is run. The seed clears the target
directory first so re-runs are idempotent.

| Window | Entry count | Coverage |
| --- | --- | --- |
| `weeks=1` (last 7 d) | 3 | days-ago: 2, 4, 6 |
| `weeks=4` (last 28 d) | 9 | days-ago: 2, 4, 6, 8, 10, 14, 18, 22, 26 (30-day entry falls just outside the window) |
| `weeks=12` (last 84 d) | 15 | all entries |

## Question design notes

The 10 questions cover the full surface of the server's three tools:

- **save_to_brag_sheet** is exercised in Q9 (round-trip) and Q10 (invalid
  category error path).
- **review_brag_sheet** is the workhorse — used in Q2–Q8 and Q9 — with windows
  ranging from 7 d to 84 d so the LLM has to reason about the time filter.
- **generate_work_log** is exercised in Q1 (full count).

Each expected answer is a single deterministic token (number, exact summary
string, repo name, category id, CVE id) so an MCP eval harness can score
with simple substring or trim-equals matching.

# Dependency maintenance

Dependabot monitors security advisories and opens available fixes. Weekly
version checks also cover npm and GitHub Actions. Security updates do not wait
for the weekly version-update schedule.

## Automatic patch merges

The **Dependency patch maintenance** workflow evaluates Dependabot PRs after
the **CI** workflow completes. A PR qualifies only when:

- It is an open, non-draft Dependabot PR from this repository targeting `main`.
- Only existing `package.json` and `package-lock.json` files are modified.
- Direct dependencies remain the approved MCP SDK and Zod. Every changed
  dependency version, including transitive versions, is a stable patch upgrade.
- The dependency set, runtime requirements, scripts, and other package metadata
  are unchanged. Manifest and lockfile versions agree.
- Tarballs use canonical public npm URLs with integrity hashes.
- All nine platform/runtime tests and four installer jobs pass. The Linux
  Node 22 job also runs `npm audit --audit-level=low`.
- Repository rules require those 13 jobs, `license/cla`, and an up-to-date branch.
  GitHub reports the PR as ready to merge.

The workflow rechecks the PR and submits a squash merge with the exact tested
head SHA. It never uses an administrator bypass or approves reviews on behalf
of a person. Ordinary GitHub auto-merge is not required or enabled.

GitHub suppresses normal push-workflow triggers for merges made with
`GITHUB_TOKEN`, so the workflow explicitly dispatches CI on `main` afterward.
It does not create tags, publish packages, or modify application configuration.

## Updates requiring review

Minor/major upgrades, prereleases, new or removed dependencies, dependency
metadata changes, GitHub Actions updates, and application/workflow edits remain
manual. Failed checks, stale branches, and incomplete protection settings also
prevent merging. The workflow maintains one review comment per PR rather than
posting repeated comments. API errors fail the run; no success is inferred.
The workflow attempts a review comment for API failures after validating PR
provenance; a GitHub outage may also prevent that comment.

If a merge succeeds but CI dispatch fails, run **Actions > CI > Run workflow**
on `main`. The failure comment identifies this recovery step. Rerunning patch
maintenance skips closed PRs rather than attempting another merge.

Dependabot cannot fix every advisory. Some fixes need an upstream release or a
larger upgrade. Check open security alerts and review comments; a clean audit
and passing tests are not a guarantee of safe dependency behavior.

## Inspect or pause

Use **Actions > Dependency patch maintenance > Run workflow** on `main`, and
provide an open PR number. Manual dispatch is always a read-only dry run:
it can inspect eligibility but cannot merge or post comments.

To pause automatic merges, disable **Dependency patch maintenance** in Actions.
Cancel an already-running maintenance job if necessary. Dependabot monitoring
and ordinary CI continue. Draft PRs are never automatically merged.

The implementation is in `.github/scripts/dependency-policy.mjs` and
`.github/scripts/dependency-maintenance.mjs`; focused tests are in
`test/dependency-policy.test.mjs` and `test/dependency-maintenance.test.mjs`.
When changing CI job names or supported runtimes, update the required repository
checks and the maintenance job list together. A mismatch fails closed.

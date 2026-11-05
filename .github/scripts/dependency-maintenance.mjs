import { readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assessDependencyPatch } from "./dependency-policy.mjs";

const REPOSITORY = "microsoft/copilot-brag-sheet";
const MARKER = "<!-- dependency-patch-automation -->";
const JOBS = [
  ...["ubuntu-latest", "windows-latest", "macos-latest"].flatMap(os => [22, 24, 26].map(v => `test (${os}, ${v})`)),
  "install-smoke (ubuntu-latest)", "install-smoke (macos-latest)",
  "install-smoke (windows / PowerShell 5.1)", "install-smoke (windows / PowerShell 7+)",
];

async function reviewComment(api, number, reason) {
  const body = `${MARKER}\nDependency patch maintenance requires attention: ${reason}\n\nMaintainer review is required. No release or npm publication was requested.`;
  for (let page = 1; ; page++) {
    const comments = await api(`/issues/${number}/comments?per_page=100&page=${page}`);
    const previous = comments.find(c => c.user?.login === "github-actions[bot]" && c.body?.startsWith(MARKER));
    if (previous) {
      if (previous.body !== body) await api(`/issues/comments/${previous.id}`, "PATCH", { body });
      return;
    }
    if (comments.length < 100) break;
  }
  await api(`/issues/${number}/comments`, "POST", { body });
}

export async function maintainPullRequest({ api: request, number, runId, dryRun = false }) {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("Invalid PR number.");
  let verified = false;
  let confirmedMerge = false;
  const api = async (path, method = "GET", body) => {
    try {
      const result = await request(path, method, body);
      if (path === `/pulls/${number}/merge` && method === "PUT" && result?.merged) confirmedMerge = true;
      return result;
    } catch (error) {
      if (verified && !dryRun) {
        const reason = confirmedMerge
          ? "The patch merged, but starting main CI failed. Run the CI workflow manually on main from Actions > CI > Run workflow. Retrying maintenance skips closed PRs."
          : "A GitHub API request failed. Inspect the PR state before retrying; if it already merged, run the CI workflow manually on main.";
        // A GitHub outage can also prevent commenting; retain the original failure.
        await reviewComment(request, number, reason).catch(() => {});
      }
      throw error;
    }
  };
  const pr = await api(`/pulls/${number}`);
  const skip = reason => ({ eligible: false, reason });
  if (pr.state !== "open" || pr.user?.login !== "dependabot[bot]" ||
      pr.head?.repo?.full_name !== REPOSITORY || pr.base?.repo?.full_name !== REPOSITORY ||
      pr.base.ref !== "main") return skip("Not an open, same-repository Dependabot PR targeting main.");
  verified = true;
  const escalate = async reason => {
    if (!dryRun) await reviewComment(api, number, reason);
    return skip(reason);
  };
  if (pr.draft) return skip("Draft PRs are never automatically merged.");
  if (!Number.isSafeInteger(pr.changed_files) || pr.changed_files < 1 || pr.changed_files > 2) {
    return escalate("Changes extend beyond the dependency manifest and lockfile.");
  }
  const files = await api(`/pulls/${number}/files?per_page=100`);
  if (files.length !== pr.changed_files || files.some(f =>
    !["package.json", "package-lock.json"].includes(f.filename) || f.status !== "modified")) {
    return escalate("Only modifications to package.json and package-lock.json qualify.");
  }
  const readJSON = async (path, sha) => {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid commit identifier.");
    const file = await api(`/contents/${path}?ref=${sha}`);
    if (file.encoding !== "base64") throw new Error("Unexpected file encoding.");
    return JSON.parse(Buffer.from(file.content, "base64").toString("utf8"));
  };
  const [beforeManifest, beforeLock, afterManifest, afterLock] = await Promise.all([
    readJSON("package.json", pr.base.sha), readJSON("package-lock.json", pr.base.sha),
    readJSON("package.json", pr.head.sha), readJSON("package-lock.json", pr.head.sha),
  ]);
  const policy = assessDependencyPatch(
    { manifest: beforeManifest, lock: beforeLock }, { manifest: afterManifest, lock: afterLock },
  );
  if (!policy.eligible) return escalate(policy.reason);
  if (runId === undefined) {
    const runs = await api(`/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=1`);
    runId = runs.workflow_runs[0]?.id;
  }
  if (!Number.isSafeInteger(runId) || runId < 1) return escalate("No CI run is available for this head.");
  const run = await api(`/actions/runs/${runId}`);
  if (run.head_sha !== pr.head.sha) return skip("The CI result belongs to an older PR head.");
  if (run.path !== ".github/workflows/ci.yml" || run.event !== "pull_request" ||
      run.head_repository?.full_name !== REPOSITORY || run.status !== "completed" || run.conclusion !== "success") {
    return escalate("The expected PR CI workflow has not completed successfully.");
  }
  const { jobs, total_count: totalJobs } = await api(`/actions/runs/${runId}/jobs?per_page=100`);
  if (totalJobs !== jobs.length || JOBS.some(name => !jobs.some(j => j.name === name && j.conclusion === "success"))) {
    return escalate("The complete test and installer matrix must pass without skipped jobs.");
  }
  const rules = await api("/rules/branches/main");
  if (!rules.some(r => r.type === "required_status_checks" && r.parameters.strict_required_status_checks_policy &&
      [...JOBS, "license/cla"].every(name => r.parameters.required_status_checks.some(c => c.context === name)))) {
    return escalate("Required checks or the up-to-date branch protection are missing.");
  }
  const fresh = await api(`/pulls/${number}`);
  if (fresh.head.sha !== pr.head.sha || fresh.base.sha !== pr.base.sha || fresh.state !== "open" || fresh.draft ||
      fresh.mergeable_state !== "clean") {
    return escalate("The PR changed, is behind main, or is blocked by a merge requirement.");
  }
  if (dryRun) return { ...policy, dryRun: true };
  const merged = await api(`/pulls/${number}/merge`, "PUT", {
    sha: pr.head.sha,
    merge_method: "squash",
    commit_message: "Automated dependency-only patch update after required checks.\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>",
  });
  if (!merged.merged) {
    await escalate("GitHub refused the merge. Review the current PR state and requirements.");
    throw new Error("GitHub refused the merge; no follow-up workflow was dispatched.");
  }
  // GITHUB_TOKEN merges do not trigger ordinary push workflows.
  await api("/actions/workflows/ci.yml/dispatches", "POST", { ref: "main" });
  return { ...policy, merged: true };
}

async function main() {
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY) throw new Error("Unexpected repository.");
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GitHub token is missing.");
  const api = async (path, method = "GET", body) => {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`GitHub ${method} ${path.split("?")[0]} failed: HTTP ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  };
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const dryRun = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
  let number;
  let runId;
  if (dryRun) {
    number = Number(event.inputs?.pull_request);
  } else {
    const run = event.workflow_run;
    if (process.env.GITHUB_EVENT_NAME !== "workflow_run" || run?.event !== "pull_request" ||
        run.head_repository?.full_name !== REPOSITORY || !run.head_branch?.startsWith("dependabot/")) return;
    const head = encodeURIComponent(`${REPOSITORY.split("/")[0]}:${run.head_branch}`);
    const prs = await api(`/pulls?state=open&base=main&head=${head}&per_page=100`);
    const matches = prs.filter(pr => pr.head.sha === run.head_sha && pr.user?.login === "dependabot[bot]");
    if (matches.length !== 1) return;
    number = matches[0].number;
    runId = run.id;
  }
  const result = await maintainPullRequest({ api, number, runId, dryRun });
  console.log(JSON.stringify({ number, ...result }));
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `PR #${number}: ${result.reason}\n\n${dryRun ? "Read-only dry run; no changes made." : result.merged ? "Merged; main CI dispatched." : "Not merged."}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

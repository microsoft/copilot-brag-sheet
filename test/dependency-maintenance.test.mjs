import { it } from "node:test";
import assert from "node:assert/strict";
import { maintainPullRequest } from "../.github/scripts/dependency-maintenance.mjs";

function scenario() {
  const sha = "a".repeat(40);
  const base = "b".repeat(40);
  const repo = "microsoft/copilot-brag-sheet";
  const manifest = { name: "example", version: "1.0.0", dependencies: { zod: "4.6.7" } };
  const lock = { lockfileVersion: 3, packages: { "": { dependencies: { zod: "4.6.7" } },
    "node_modules/zod": { version: "4.6.7", resolved: "https://registry.npmjs.org/zod/-/zod-4.6.7.tgz", integrity: "sha512-old" } } };
  const next = structuredClone(manifest);
  next.dependencies.zod = "4.6.8";
  const nextLock = structuredClone(lock);
  nextLock.packages[""].dependencies.zod = "4.6.8";
  Object.assign(nextLock.packages["node_modules/zod"], {
    version: "4.6.8", resolved: "https://registry.npmjs.org/zod/-/zod-4.6.8.tgz", integrity: "sha512-new",
  });
  const names = [
    ...["ubuntu-latest", "windows-latest", "macos-latest"].flatMap(os => [22, 24, 26].map(v => `test (${os}, ${v})`)),
    "install-smoke (ubuntu-latest)", "install-smoke (macos-latest)",
    "install-smoke (windows / PowerShell 5.1)", "install-smoke (windows / PowerShell 7+)",
  ];
  const data = {
    "/pulls/7": { number: 7, state: "open", draft: false, user: { login: "dependabot[bot]" },
      base: { ref: "main", sha: base, repo: { full_name: repo } },
      head: { ref: "dependabot/npm_and_yarn/zod-4.6.8", sha, repo: { full_name: repo } },
      changed_files: 2, mergeable_state: "clean" },
    "/pulls/7/files?per_page=100": [{ filename: "package.json", status: "modified" }, { filename: "package-lock.json", status: "modified" }],
    "/actions/runs/17": { event: "pull_request", path: ".github/workflows/ci.yml", head_sha: sha,
      head_repository: { full_name: repo }, status: "completed", conclusion: "success" },
    "/actions/runs/17/jobs?per_page=100": { total_count: 13, jobs: names.map(name => ({ name, conclusion: "success" })) },
    "/rules/branches/main": [{ type: "required_status_checks", parameters: {
      strict_required_status_checks_policy: true,
      required_status_checks: [...names, "license/cla"].map(context => ({ context })),
    } }],
    "/issues/7/comments?per_page=100&page=1": [],
  };
  for (const [ref, pkg, graph] of [[base, manifest, lock], [sha, next, nextLock]]) {
    for (const [path, content] of [["package.json", pkg], ["package-lock.json", graph]]) {
      data[`/contents/${path}?ref=${ref}`] = { encoding: "base64", content: Buffer.from(JSON.stringify(content)).toString("base64") };
    }
  }
  const writes = [];
  const api = async (path, method = "GET", body) => {
    if (method !== "GET") {
      writes.push({ path, method, body });
      return path.endsWith("/merge") ? { merged: true } : {};
    }
    assert.ok(path in data, `Unexpected request: ${path}`);
    return structuredClone(data[path]);
  };
  return { data, writes, api, sha };
}

it("merges the exact verified head and explicitly dispatches main CI", async () => {
  const s = scenario();
  const result = await maintainPullRequest({ api: s.api, number: 7, runId: 17 });
  assert.equal(result.merged, true);
  assert.deepEqual(s.writes.map(w => [w.path, w.method]), [
    ["/pulls/7/merge", "PUT"], ["/actions/workflows/ci.yml/dispatches", "POST"],
  ]);
  assert.equal(s.writes[0].body.sha, s.sha);
  assert.equal(s.writes[0].body.merge_method, "squash");
  assert.equal(s.writes[1].body.ref, "main");
});

it("dry runs perform no writes even for an eligible update", async () => {
  const s = scenario();
  assert.equal((await maintainPullRequest({ api: s.api, number: 7, runId: 17, dryRun: true })).eligible, true);
  assert.deepEqual(s.writes, []);
});

for (const [name, mutate] of [
  ["a human-authored PR", d => { d["/pulls/7"].user.login = "maintainer"; }],
  ["a fork branch", d => { d["/pulls/7"].head.repo.full_name = "other/fork"; }],
  ["a draft PR", d => { d["/pulls/7"].draft = true; }],
  ["application code changes", d => { d["/pulls/7/files?per_page=100"][0].filename = "extension.mjs"; }],
  ["an older CI head", d => { d["/actions/runs/17"].head_sha = "c".repeat(40); }],
  ["failed CI", d => { d["/actions/runs/17"].conclusion = "failure"; }],
  ["a skipped installer check", d => { d["/actions/runs/17/jobs?per_page=100"].jobs[12].conclusion = "skipped"; }],
  ["a different workflow", d => { d["/actions/runs/17"].path = ".github/workflows/other.yml"; }],
  ["weakened branch protection", d => { d["/rules/branches/main"][0].parameters.strict_required_status_checks_policy = false; }],
  ["a blocked PR", d => { d["/pulls/7"].mergeable_state = "blocked"; }],
]) {
  it(`never merges ${name}`, async () => {
    const s = scenario();
    mutate(s.data);
    assert.equal((await maintainPullRequest({ api: s.api, number: 7, runId: 17 })).merged, undefined);
    assert.ok(s.writes.every(w => !w.path.endsWith("/merge") && !w.path.endsWith("/dispatches")));
  });
}

it("updates its existing review comment rather than spamming new comments", async () => {
  const s = scenario();
  s.data["/actions/runs/17"].conclusion = "failure";
  s.data["/issues/7/comments?per_page=100&page=1"] = [{
    id: 12, user: { login: "github-actions[bot]" }, body: "<!-- dependency-patch-automation -->\nOld result",
  }];
  await maintainPullRequest({ api: s.api, number: 7, runId: 17 });
  assert.equal(s.writes.length, 1);
  assert.equal(s.writes[0].path, "/issues/comments/12");
  assert.equal(s.writes[0].method, "PATCH");
});

it("does not dispatch CI when GitHub refuses the merge", async () => {
  const s = scenario();
  const api = (path, method, body) => path.endsWith("/merge") ? { merged: false } : s.api(path, method, body);
  await assert.rejects(maintainPullRequest({ api, number: 7, runId: 17 }), /merge/i);
  assert.ok(!s.writes.some(w => w.path.endsWith("/dispatches")));
});

it("rechecks the head immediately before merging", async () => {
  const s = scenario();
  let reads = 0;
  const api = async (path, method, body) => {
    const result = await s.api(path, method, body);
    if (path === "/pulls/7" && ++reads === 2) result.head.sha = "c".repeat(40);
    return result;
  };
  assert.equal((await maintainPullRequest({ api, number: 7, runId: 17 })).eligible, false);
  assert.ok(!s.writes.some(w => w.path.endsWith("/merge")));
});

it("dry runs never post escalation comments", async () => {
  const s = scenario();
  s.data["/actions/runs/17"].conclusion = "failure";
  assert.equal((await maintainPullRequest({ api: s.api, number: 7, runId: 17, dryRun: true })).eligible, false);
  assert.deepEqual(s.writes, []);
});

it("posts a review comment when the merge API throws", async () => {
  const s = scenario();
  const api = (path, method, body) => {
    if (path.endsWith("/merge")) throw new Error("HTTP 405");
    return s.api(path, method, body);
  };
  await assert.rejects(maintainPullRequest({ api, number: 7, runId: 17 }), /405/);
  assert.ok(s.writes.some(w => w.path === "/issues/7/comments"));
  assert.ok(!s.writes.some(w => w.path.endsWith("/dispatches")));
});

it("provides manual main-CI recovery when dispatch fails after a merge", async () => {
  const s = scenario();
  const api = (path, method, body) => {
    if (path.endsWith("/dispatches")) throw new Error("HTTP 503");
    return s.api(path, method, body);
  };
  await assert.rejects(maintainPullRequest({ api, number: 7, runId: 17 }), /503/);
  assert.equal(s.writes.filter(w => w.path.endsWith("/merge")).length, 1);
  const comment = s.writes.find(w => w.path === "/issues/7/comments");
  assert.ok(comment);
  assert.match(comment.body.body, /merged/);
  assert.match(comment.body.body, /CI workflow manually on main/);
});

it("dry-run API failures never write escalation comments", async () => {
  const s = scenario();
  const api = (path, method, body) => {
    if (path.startsWith("/contents/")) throw new Error("HTTP 503");
    return s.api(path, method, body);
  };
  await assert.rejects(maintainPullRequest({ api, number: 7, runId: 17, dryRun: true }), /503/);
  assert.deepEqual(s.writes, []);
});

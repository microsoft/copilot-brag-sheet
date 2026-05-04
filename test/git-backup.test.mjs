import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { backupToGit, ensureGitRepo, addRemote, hasRemote, createGitRunner } from "../lib/git-backup.mjs";

let testDir;

before(() => {
  testDir = mkdtempSync(join(tmpdir(), "git-backup-test-"));
});

after(() => {
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* noop */ }
});

function makeDataDir(name) {
  const dir = join(testDir, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function extractCmd(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("-")) continue;
    return args[i];
  }
  return null;
}

function mockGitRunner(results = {}) {
  const calls = [];
  const runner = (args) => {
    calls.push({ args });
    const cmd = extractCmd(args);
    const result = results[cmd] || { code: 0, stdout: "", stderr: "" };
    return Promise.resolve(result);
  };
  return { runner, calls };
}

// ── backupToGit ─────────────────────────────────────────────────────────────

describe("backupToGit", () => {
  it("skips when gitConfig.enabled is false", async () => {
    const result = await backupToGit({
      dataDir: makeDataDir("disabled"),
      gitConfig: { enabled: false },
    });
    assert.equal(result.action, "skipped");
    assert.equal(result.success, true);
  });

  it("skips when dataDir is null", async () => {
    const result = await backupToGit({
      dataDir: null,
      gitConfig: { enabled: true },
    });
    assert.equal(result.action, "skipped");
  });

  it("skips when .git dir does not exist", async () => {
    const result = await backupToGit({
      dataDir: makeDataDir("no-git"),
      gitConfig: { enabled: true },
    });
    assert.equal(result.action, "skipped");
  });

  it("commits when staged changes exist", async () => {
    const dataDir = makeDataDir("commit-flow");
    mkdirSync(join(dataDir, ".git"));

    const { runner, calls } = mockGitRunner({
      diff: { code: 1, stdout: "", stderr: "" },
    });

    const result = await backupToGit({
      dataDir,
      gitConfig: { enabled: true, push: false },
      runGit: runner,
    });

    assert.equal(result.success, true);
    assert.equal(result.action, "committed");

    const cmds = calls.map((c) => extractCmd(c.args));
    assert.ok(cmds.includes("add"));
    assert.ok(cmds.includes("diff"));
    assert.ok(cmds.includes("commit"));
    assert.ok(!cmds.includes("remote"));
  });

  it("skips commit when no staged changes", async () => {
    const dataDir = makeDataDir("no-changes");
    mkdirSync(join(dataDir, ".git"));

    const { runner, calls } = mockGitRunner({
      diff: { code: 0, stdout: "", stderr: "" },
    });

    const result = await backupToGit({
      dataDir,
      gitConfig: { enabled: true },
      runGit: runner,
    });

    assert.equal(result.action, "no-changes");
    const cmds = calls.map((c) => extractCmd(c.args));
    assert.ok(!cmds.includes("commit"));
  });

  it("handles git add failure", async () => {
    const dataDir = makeDataDir("add-fail");
    mkdirSync(join(dataDir, ".git"));

    const { runner } = mockGitRunner({
      add: { code: 128, stdout: "", stderr: "fatal" },
    });

    const result = await backupToGit({
      dataDir,
      gitConfig: { enabled: true },
      runGit: runner,
    });

    assert.equal(result.success, false);
    assert.equal(result.action, "add-failed");
  });

  it("handles git commit failure", async () => {
    const dataDir = makeDataDir("commit-fail");
    mkdirSync(join(dataDir, ".git"));

    const { runner } = mockGitRunner({
      diff: { code: 1 },
      commit: { code: 1, stderr: "conflict" },
    });

    const result = await backupToGit({
      dataDir,
      gitConfig: { enabled: true },
      runGit: runner,
    });

    assert.equal(result.success, false);
    assert.equal(result.action, "commit-failed");
  });

  it("pushes when push enabled and remote exists", async () => {
    const dataDir = makeDataDir("push-flow");
    mkdirSync(join(dataDir, ".git"));

    const { runner, calls } = mockGitRunner({
      diff: { code: 1 },
      remote: { code: 0, stdout: "https://github.com/u/r.git" },
    });

    const result = await backupToGit({
      dataDir,
      gitConfig: { enabled: true, push: true },
      runGit: runner,
    });

    assert.equal(result.success, true);
    assert.equal(result.action, "committed");

    const cmds = calls.map((c) => extractCmd(c.args));
    assert.ok(cmds.includes("remote"));
    assert.ok(cmds.includes("pull"));
    assert.ok(cmds.includes("push"));
  });

  it("aborts rebase and skips push when pull --rebase fails", async () => {
    // Regression test: previously an unhandled `git pull --rebase` failure
    // would leave the data-dir repo in an unfinished-rebase state, breaking
    // every subsequent save (commit refuses while a rebase is in progress).
    const dataDir = makeDataDir("rebase-conflict");
    mkdirSync(join(dataDir, ".git"));

    const { runner, calls } = mockGitRunner({
      diff: { code: 1 },
      remote: { code: 0, stdout: "https://github.com/u/r.git" },
      pull: { code: 1, stderr: "CONFLICT: cannot fast-forward" },
    });

    const result = await backupToGit({
      dataDir,
      gitConfig: { enabled: true, push: true },
      runGit: runner,
    });

    assert.equal(result.success, false);
    assert.equal(result.action, "pull-conflict");

    const argsPerCall = calls.map((c) => c.args);
    // We saw a `pull --rebase`...
    assert.ok(argsPerCall.some((a) => a[0] === "pull" && a.includes("--rebase")));
    // ...followed by a cleanup `rebase --abort`...
    assert.ok(argsPerCall.some((a) => a[0] === "rebase" && a.includes("--abort")));
    // ...and we did NOT push (would propagate desynced state to remote).
    assert.ok(!argsPerCall.some((a) => a[0] === "push"));
  });

  it("never throws on unexpected errors", async () => {
    const dataDir = makeDataDir("throws");
    mkdirSync(join(dataDir, ".git"));

    const result = await backupToGit({
      dataDir,
      gitConfig: { enabled: true },
      runGit: () => { throw new Error("boom"); },
    });

    assert.equal(typeof result.success, "boolean");
  });
});

// ── ensureGitRepo ───────────────────────────────────────────────────────────

describe("ensureGitRepo", () => {
  it("returns false for null dataDir", async () => {
    assert.equal(await ensureGitRepo(null), false);
  });

  it("returns true if .git already exists", async () => {
    const dataDir = makeDataDir("existing");
    mkdirSync(join(dataDir, ".git"));
    assert.equal(await ensureGitRepo(dataDir, mockGitRunner().runner), true);
  });

  it("inits repo with .gitignore and README", async () => {
    const dataDir = makeDataDir("fresh-init");
    const { runner, calls } = mockGitRunner();

    const result = await ensureGitRepo(dataDir, runner);
    assert.equal(result, true);

    assert.ok(existsSync(join(dataDir, ".gitignore")));
    assert.ok(existsSync(join(dataDir, "README.md")));

    const cmds = calls.map((c) => extractCmd(c.args));
    assert.ok(cmds.includes("init"));
    assert.ok(cmds.includes("add"));
    assert.ok(cmds.includes("commit"));
  });

  it("returns false when git init fails", async () => {
    const dataDir = makeDataDir("init-fail");
    const { runner } = mockGitRunner({
      init: { code: 128, stderr: "fatal" },
    });
    assert.equal(await ensureGitRepo(dataDir, runner), false);
  });
});

// ── addRemote / hasRemote ───────────────────────────────────────────────────

describe("addRemote and hasRemote", () => {
  it("addRemote returns false for null inputs", async () => {
    assert.equal(await addRemote(null, "url"), false);
    assert.equal(await addRemote("/tmp", null), false);
  });

  it("addRemote calls git remote add", async () => {
    const { runner, calls } = mockGitRunner();
    assert.equal(await addRemote("/tmp", "https://github.com/u/r.git", runner), true);
    assert.ok(calls[0].args.includes("origin"));
  });

  it("hasRemote detects remote presence", async () => {
    const withRemote = mockGitRunner({ remote: { code: 0, stdout: "https://url" } });
    const noRemote = mockGitRunner({ remote: { code: 2, stdout: "" } });

    assert.equal(await hasRemote("/tmp", withRemote.runner), true);
    assert.equal(await hasRemote("/tmp", noRemote.runner), false);
    assert.equal(await hasRemote(null), false);
  });
});

// ── createGitRunner ─────────────────────────────────────────────────────────

describe("createGitRunner", () => {
  it("returns a function", () => {
    assert.equal(typeof createGitRunner(), "function");
  });

  it("uses injected implementation", async () => {
    const calls = [];
    const mock = (cmd, args, opts, cb) => { calls.push(args); cb(null, "ok", ""); };
    const result = await createGitRunner(mock)(["status"], "/tmp");
    assert.equal(result.stdout, "ok");
    assert.equal(result.code, 0);
  });
});

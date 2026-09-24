import { it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readRecords } from "../lib/storage.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const scenarios = [
  "parent-lifecycle",
  "delegated-lifecycle",
  "delegated-starts-first",
  "resume",
  "resume-from-disk",
  "orphan-recovery",
  "failure-counters",
  "paths",
  "cross-repo-paths",
  "shutdown",
  "compaction",
  "tools",
  "concurrent-hooks",
  "shutdown-during-hooks",
  "process-exit",
  "natural-exit",
  "host-disconnect",
  "finalized-process-exit",
  "incomplete-process-exit",
  "finalized-host-disconnect",
  "process-sigterm",
  "process-sigint",
];

for (const scenario of scenarios) {
  const signalScenario = scenario === "process-sigterm" || scenario === "process-sigint";
  it(`executes the extension adapter: ${scenario}`, {
    timeout: 30000,
    skip: signalScenario && process.platform === "win32"
      ? "Windows process.kill terminates without delivering catchable POSIX signals" : false,
  }, async () => {
    const scratch = mkdtempSync(path.join(root, ".extension-adapter-"));
    try {
      const sdk = path.join(scratch, "node_modules", "@github", "copilot-sdk");
      mkdirSync(sdk, { recursive: true });
      mkdirSync(path.join(scratch, "data"));
      mkdirSync(path.join(scratch, "home"));
      mkdirSync(path.join(scratch, "workspace"));
      cpSync(path.join(root, "extension.mjs"), path.join(scratch, "extension.mjs"));
      cpSync(path.join(root, "package.json"), path.join(scratch, "package.json"));
      cpSync(path.join(root, "lib"), path.join(scratch, "lib"), { recursive: true });
      cpSync(path.join(root, "test", "fixtures", "extension-host.fixture"),
        path.join(scratch, "host.mjs"));
      cpSync(path.join(root, "test", "fixtures", "copilot-sdk.fixture"),
        path.join(sdk, "extension.mjs"));
      writeFileSync(path.join(sdk, "package.json"), JSON.stringify({
        name: "@github/copilot-sdk",
        type: "module",
        exports: { "./extension": "./extension.mjs" },
      }));
      writeFileSync(path.join(scratch, "data", "config.json"),
        JSON.stringify({ git: { enabled: false, push: false } }));

      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (/^(WORK_TRACKER_|BRAG_SHEET_|GIT_|COPILOT_)/i.test(key)) delete env[key];
      }
      delete env.NODE_OPTIONS;
      delete env.NODE_PATH;
      Object.assign(env, {
        WORK_TRACKER_DIR: path.join(scratch, "data"),
        HOME: path.join(scratch, "home"),
        USERPROFILE: path.join(scratch, "home"),
        GIT_CONFIG_GLOBAL: path.join(scratch, "home", "gitconfig"),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      });
      const phases = scenario === "resume-from-disk"
        ? ["resume-from-disk-seed", scenario] : [scenario];
      for (const phase of phases) {
        const execution = exec(process.execPath,
          [path.join(scratch, "host.mjs"), phase],
          { cwd: scratch, env, timeout: 25000, windowsHide: true });
        if (phase.endsWith("host-disconnect")) execution.child.stdin.end();
        let result;
        try {
          result = await execution;
          assert.equal(signalScenario, false, "signal handler must retain a nonzero exit status");
        } catch (error) {
          if (!signalScenario) throw error;
          assert.equal(error.code, scenario === "process-sigterm" ? 143 : 130);
          assert.equal(error.signal, null, "the adapter must handle the signal before exiting");
          result = error;
        }
        const { stdout, stderr } = result;
        assert.equal(stdout, "", "the adapter must not write to the protocol channel");
        assert.equal(stderr, "");
      }
      if (scenario.endsWith("process-exit") || scenario.endsWith("host-disconnect")
        || scenario === "natural-exit" || signalScenario) {
        const records = readRecords(path.join(scratch, "data"), { type: "session" });
        assert.equal(records.length, 1);
        const record = records[0];
        assert.deepEqual(record.filesEdited, ["saved-before-exit.mjs"]);
        assert.equal(record.capture.successfulToolCount, 1);
        assert.ok(record.endTime);
        if (scenario.startsWith("finalized-") || scenario.startsWith("incomplete-")) {
          assert.equal(record.status, scenario.split("-")[0]);
          assert.equal(record.endReason, scenario.startsWith("finalized-") ? "complete" : "error");
          assert.equal(record.summary, "Host final summary");
          assert.equal(record.capture.summarySource, "finalMessage");
          assert.equal(record.endTime, "2026-09-24T12:00:00.000Z");
        } else {
          assert.equal(record.status, "emergency-saved");
          assert.equal(record.endReason, "shutdown");
          assert.equal(record.summary, "Fix adapter capture");
          assert.equal(record.capture.summarySource, "taskDescription");
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
}

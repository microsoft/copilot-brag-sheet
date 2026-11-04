import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const installer = new URL("../bin/install.mjs", import.meta.url).href;
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runInstaller(version) {
  const root = mkdtempSync(join(tmpdir(), "brag-install-runtime-"));
  roots.push(root);
  const home = join(root, "copilot");
  const target = join(home, "extensions", "copilot-brag-sheet");
  mkdirSync(target, { recursive: true });
  const marker = join(target, "existing.txt");
  writeFileSync(marker, "existing installation");
  const data = join(root, "data");
  mkdirSync(data);
  const record = join(data, "saved.txt");
  writeFileSync(record, "existing work");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });
    await import(${JSON.stringify(installer)});
  `], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, COPILOT_HOME: home, WORK_TRACKER_DIR: data },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  return { result, target, marker, record };
}

describe("npm installer runtime preflight", () => {
  it("rejects Node 20 before replacing an existing installation", () => {
    const { result, marker, record } = runInstaller("20.19.0");
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /Node\.js 22\+ required/);
    assert.equal(readFileSync(marker, "utf8"), "existing installation");
    assert.equal(readFileSync(record, "utf8"), "existing work");
  });

  it("installs at the Node 22 boundary without changing saved work", () => {
    const { result, target, record } = runInstaller("22.0.0");
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(target, "extension.mjs")));
    assert.ok(existsSync(join(target, "lib", "storage.mjs")));
    assert.equal(readFileSync(record, "utf8"), "existing work");
  });
});

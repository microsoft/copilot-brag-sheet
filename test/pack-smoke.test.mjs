/**
 * Packed-tarball smoke test.
 *
 * Builds the package the way `npm publish` would, installs the resulting
 * tarball into a scratch directory, then drives the installed MCP bin
 * over JSON-RPC. Catches the class of bug where source-tree tests pass
 * but the published package is broken — missing files in the tarball,
 * wrong bin paths, broken `import` traversals across the install layout,
 * or a release workflow that forgot to install dependencies.
 *
 * This is the gate that would have caught the v1.0.4 bin-shim bug before
 * the regression test we added at the source-tree level.
 *
 * Skipped when `BRAG_SHEET_SKIP_PACK_TEST=1` (offline laptops, locked-down
 * sandboxes). Always runs in CI.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir, platform } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const IS_WINDOWS = platform() === "win32";
const SKIP = process.env.BRAG_SHEET_SKIP_PACK_TEST === "1";

let workDir;
let installDir;
let binPath;

function runSync(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: IS_WINDOWS,
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (exit ${r.status})\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
    );
  }
  return r;
}

before(() => {
  if (SKIP) return;
  workDir = mkdtempSync(join(tmpdir(), "bs-pack-"));
  // 1. Build the tarball from the source tree.
  runSync("npm", ["pack", "--pack-destination", workDir], { cwd: PKG_ROOT });
  const tgz = readdirSync(workDir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`npm pack produced no tarball in ${workDir}`);
  // 2. Install it into a scratch prefix. --no-audit --no-fund keeps logs
  //    quiet; --omit=dev avoids pulling devDeps we do not have.
  installDir = join(workDir, "install");
  runSync("npm", [
    "install",
    "--no-audit",
    "--no-fund",
    "--omit=dev",
    "--prefix",
    installDir,
    join(workDir, tgz),
  ]);
  // 3. Resolve the bin the way an MCP host would after `npx -y --package
  //    copilot-brag-sheet copilot-brag-sheet-mcp`. We intentionally walk to
  //    the file (not the .bin shim) because the JSON-RPC channel needs a
  //    plain `node <file>` invocation we can spawn portably across OSes.
  binPath = join(
    installDir,
    "node_modules",
    "copilot-brag-sheet",
    "bin",
    "mcp-server.mjs",
  );
});

after(() => {
  if (SKIP || !workDir) return;
  try { rmSync(workDir, { recursive: true, force: true }); } catch { /* noop */ }
});

describe("packed tarball: MCP bin smoke", { skip: SKIP }, () => {
  it("the published bin completes initialize + tools/list", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bs-pack-data-"));
    try {
      const { responses, code, stderr } = await runRpc(binPath, dataDir, [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "pack-smoke", version: "1.0.0" },
          },
        },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]);
      assert.equal(code, 0, `bin exited non-zero. stderr: ${stderr}`);
      const init = responses.find((r) => r.id === 1);
      assert.equal(
        init?.result?.serverInfo?.name,
        "brag-sheet-mcp-server",
        `initialize did not return serverInfo. responses: ${JSON.stringify(responses)}\nstderr: ${stderr}`,
      );
      const list = responses.find((r) => r.id === 2);
      const names = (list?.result?.tools ?? []).map((t) => t.name).sort();
      assert.deepEqual(names, [
        "generate_work_log",
        "review_brag_sheet",
        "save_to_brag_sheet",
      ]);
    } finally {
      try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });
});

function runRpc(bin, dataDir, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin], {
      env: { ...process.env, WORK_TRACKER_DIR: dataDir },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdoutBuf = "";
    let stderr = "";
    const responses = [];
    const waiters = new Map();
    const timeout = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* noop */ }
      reject(new Error(`pack-smoke RPC timed out after 30s. stderr: ${stderr}`));
    }, 30_000);

    child.stdout.on("data", (b) => {
      stdoutBuf += b.toString("utf8");
      let nl;
      while ((nl = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;
        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }
        responses.push(parsed);
        const w = waiters.get(parsed.id);
        if (w) {
          waiters.delete(parsed.id);
          w(parsed);
        }
      }
    });
    child.stderr.on("data", (b) => { stderr += b.toString("utf8"); });
    child.on("error", (err) => { clearTimeout(timeout); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ responses, code, stderr });
    });

    (async () => {
      for (const req of requests) {
        const got = new Promise((r) => waiters.set(req.id, r));
        child.stdin.write(`${JSON.stringify(req)}\n`);
        await Promise.race([got, new Promise((r) => setTimeout(r, 5000))]);
      }
      child.stdin.end();
    })().catch((err) => { clearTimeout(timeout); reject(err); });
  });
}

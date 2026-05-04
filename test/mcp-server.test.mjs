/**
 * Integration tests for mcp-server.mjs
 *
 * Spawns the server as a subprocess and drives it over stdio with real
 * JSON-RPC frames. Each test asserts both the wire-protocol shape and that
 * the underlying lib/ side-effects happened (records on disk, work-log file
 * written, etc.) using an isolated WORK_TRACKER_DIR per test run.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { readRecords } from "../lib/storage.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, "..", "mcp-server.mjs");

let dataDir;

before(() => {
  dataDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
});

after(() => {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* noop */ }
});

/**
 * Spawn the MCP server, send an array of requests as newline-delimited JSON
 * on stdin, close stdin, and collect newline-delimited JSON responses from
 * stdout. Notifications (no id) produce no response, so callers should only
 * count requests with ids.
 */
function runRpc(requests, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, WORK_TRACKER_DIR: dataDir, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b.toString("utf8"); });
    child.stderr.on("data", (b) => { stderr += b.toString("utf8"); });

    child.on("error", reject);
    child.on("close", (code) => {
      const responses = stdout
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line));
      resolve({ responses, stderr, code });
    });

    for (const req of requests) {
      child.stdin.write(`${JSON.stringify(req)}\n`);
    }
    child.stdin.end();
  });
}

describe("mcp-server: protocol handshake", () => {
  it("responds to initialize with protocol + capabilities + serverInfo", async () => {
    const { responses } = await runRpc([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    ]);

    assert.equal(responses.length, 1, "expected one response");
    const [res] = responses;
    assert.equal(res.jsonrpc, "2.0");
    assert.equal(res.id, 1);
    assert.ok(res.result, "result missing");
    assert.equal(typeof res.result.protocolVersion, "string");
    assert.ok(res.result.capabilities, "capabilities missing");
    assert.ok(res.result.capabilities.tools !== undefined, "tools capability missing");
    assert.equal(res.result.serverInfo?.name, "copilot-brag-sheet");
    assert.ok(res.result.serverInfo?.version, "serverInfo.version missing");
  });

  it("ignores notifications (no id) without responding or erroring", async () => {
    const { responses } = await runRpc([
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 1, method: "ping" },
    ]);
    assert.equal(responses.length, 1, "only the ping should produce a response");
    assert.equal(responses[0].id, 1);
    assert.deepEqual(responses[0].result, {});
  });

  it("returns -32601 for unknown methods", async () => {
    const { responses } = await runRpc([
      { jsonrpc: "2.0", id: 1, method: "does/not/exist" },
    ]);
    assert.equal(responses[0].error?.code, -32601);
  });

  it("returns -32700 for malformed JSON", async () => {
    // Bypass runRpc helper because we need to send raw garbage bytes.
    const child = spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, WORK_TRACKER_DIR: dataDir },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (b) => { stdout += b.toString("utf8"); });

    child.stdin.write("this is not json\n");
    child.stdin.end();
    await new Promise((r) => child.on("close", r));

    const lines = stdout.split("\n").filter((l) => l.trim());
    assert.equal(lines.length, 1);
    const res = JSON.parse(lines[0]);
    assert.equal(res.error?.code, -32700);
  });
});

describe("mcp-server: tools/list", () => {
  it("lists exactly the three brag-sheet tools with input schemas", async () => {
    const { responses } = await runRpc([
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ]);
    const tools = responses[0].result.tools;
    assert.equal(tools.length, 3);
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["generate_work_log", "review_brag_sheet", "save_to_brag_sheet"]);

    for (const tool of tools) {
      assert.equal(typeof tool.description, "string");
      assert.equal(tool.inputSchema.type, "object");
      assert.ok(tool.inputSchema.properties, `${tool.name} missing properties`);
    }

    const save = tools.find((t) => t.name === "save_to_brag_sheet");
    assert.deepEqual(save.inputSchema.required, ["summary"]);
    assert.ok(save.inputSchema.properties.summary);
    assert.ok(save.inputSchema.properties.category);
    assert.ok(save.inputSchema.properties.tags);
  });
});

describe("mcp-server: save_to_brag_sheet", () => {
  it("persists an entry record and returns a confirmation", async () => {
    const { responses } = await runRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "save_to_brag_sheet",
          arguments: {
            summary: "Built the MCP server scaffold for cross-engine support",
            category: "tooling",
            impact: "Unblocks Claude Code / Codex / Cursor users",
            tags: ["mcp", "scaffold"],
            repo: "copilot-brag-sheet",
            branch: "mcp-server-scaffold",
          },
        },
      },
    ]);

    const res = responses[0];
    assert.ok(res.result, `expected result, got ${JSON.stringify(res)}`);
    assert.ok(!res.result.isError, "tool returned isError");
    assert.match(res.result.content[0].text, /saved to brag sheet/i);

    const records = readRecords(dataDir, { type: "entry" });
    const matches = records.filter(
      (r) => r.summary === "Built the MCP server scaffold for cross-engine support",
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].category, "tooling");
    assert.deepEqual(matches[0].tags, ["mcp", "scaffold"]);
    assert.equal(matches[0].repo, "copilot-brag-sheet");
  });

  it("returns isError=true when summary is missing", async () => {
    const { responses } = await runRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "save_to_brag_sheet", arguments: {} },
      },
    ]);
    assert.equal(responses[0].result.isError, true);
    assert.match(responses[0].result.content[0].text, /summary is required/i);
  });

  it("returns isError=true for an invalid category", async () => {
    const { responses } = await runRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "save_to_brag_sheet",
          arguments: { summary: "x", category: "not-a-real-category" },
        },
      },
    ]);
    assert.equal(responses[0].result.isError, true);
    assert.match(responses[0].result.content[0].text, /invalid category/i);
  });
});

describe("mcp-server: review_brag_sheet", () => {
  it("returns markdown for entries within the requested window", async () => {
    // Seed via save_to_brag_sheet, then review.
    const { responses } = await runRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "save_to_brag_sheet",
          arguments: { summary: "Review-test entry alpha", category: "documentation" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "review_brag_sheet", arguments: { weeks: 4 } },
      },
    ]);

    assert.equal(responses.length, 2);
    const review = responses[1].result;
    assert.ok(!review.isError);
    assert.match(review.content[0].text, /Review-test entry alpha/);
  });
});

describe("mcp-server: generate_work_log", () => {
  it("writes a markdown file at the requested outputPath", async () => {
    const outputPath = join(dataDir, "out", "work-log.md");
    const { responses } = await runRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "save_to_brag_sheet",
          arguments: { summary: "Work-log fixture entry", category: "tooling" },
        },
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "generate_work_log", arguments: { outputPath } },
      },
    ]);

    const gen = responses[1].result;
    assert.ok(!gen.isError, gen.content?.[0]?.text);
    assert.match(gen.content[0].text, /Work log generated/);
    assert.ok(existsSync(outputPath), `expected file at ${outputPath}`);
    const md = readFileSync(outputPath, "utf8");
    assert.ok(md.length > 0, "work log file is empty");
  });
});

describe("mcp-server: unknown tool", () => {
  it("returns a JSON-RPC error for an unknown tool name", async () => {
    const { responses } = await runRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "does_not_exist", arguments: {} },
      },
    ]);
    assert.equal(responses[0].error?.code, -32602);
    assert.match(responses[0].error.message, /Unknown tool/);
  });
});

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
const BIN_PATH = join(__dirname, "..", "bin", "mcp-server.mjs");
const SERVER_NAME = "brag-sheet-mcp-server";

let dataDir;

before(() => {
  dataDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
});

after(() => {
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* noop */ }
});

/**
 * Spawn the MCP server, send each request as a newline-delimited JSON-RPC
 * frame waiting for the matching response before sending the next, then
 * close stdin and resolve with all collected responses. Notifications
 * (no id) produce no response so they are dispatched without a wait.
 *
 * Sequential send mirrors how an MCP host actually drives the wire — one
 * request, then await its matching response — and avoids races with the
 * SDK's concurrent request-validation pipeline.
 */
function runRpc(requests, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, WORK_TRACKER_DIR: dataDir, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBuf = "";
    let stderr = "";
    const responses = [];
    const waiters = new Map();

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

    child.on("error", reject);
    child.on("close", (code) => {
      if (stdoutBuf.trim()) {
        try { responses.push(JSON.parse(stdoutBuf.trim())); } catch { /* noop */ }
      }
      resolve({ responses, stderr, code });
    });

    (async () => {
      for (const req of requests) {
        if (req.id == null) {
          // Notification — no response expected, write and move on.
          child.stdin.write(`${JSON.stringify(req)}\n`);
          continue;
        }
        const got = new Promise((r) => waiters.set(req.id, r));
        child.stdin.write(`${JSON.stringify(req)}\n`);
        // Wait at most 5 s per request so a hung server fails the test
        // quickly rather than wedging the suite.
        await Promise.race([
          got,
          new Promise((r) => setTimeout(r, 5000)),
        ]);
      }
      child.stdin.end();
    })().catch(reject);
  });
}

describe("mcp-server: protocol handshake", () => {
  it("bin entry point boots the server (regression: bin shim must call runServer)", async () => {
    // The bin/mcp-server.mjs shim is what end users invoke via
    // `npx copilot-brag-sheet-mcp` and `claude mcp add ... -- npx ...`.
    // It must actually start the transport — driving SERVER_PATH directly is
    // not enough to catch a broken shim.
    const child = spawn(process.execPath, [BIN_PATH], {
      env: { ...process.env, WORK_TRACKER_DIR: dataDir },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (b) => { stdout += b.toString("utf8"); });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    })}\n`);
    // Give the server a moment to respond before closing stdin.
    await new Promise((r) => setTimeout(r, 500));
    child.stdin.end();
    const code = await new Promise((r) => child.on("close", r));

    assert.equal(code, 0, "bin shim exited non-zero");
    const lines = stdout.split("\n").filter((l) => l.trim());
    const init = lines.map((l) => JSON.parse(l)).find((m) => m.id === 1);
    assert.ok(init?.result?.serverInfo?.name, `bin shim never replied to initialize; stdout was: ${stdout}`);
    assert.equal(init.result.serverInfo.name, SERVER_NAME);
  });

  it("responds to initialize with protocol + capabilities + serverInfo", async () => {
    const { responses } = await runRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      },
    ]);

    assert.equal(responses.length, 1, "expected one response");
    const [res] = responses;
    assert.equal(res.jsonrpc, "2.0");
    assert.equal(res.id, 1);
    assert.ok(res.result, "result missing");
    assert.equal(typeof res.result.protocolVersion, "string");
    assert.ok(res.result.capabilities, "capabilities missing");
    assert.ok(res.result.capabilities.tools !== undefined, "tools capability missing");
    assert.equal(res.result.serverInfo?.name, SERVER_NAME);
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

  it("does not crash on malformed JSON over stdio", async () => {
    // The MCP SDK's StdioServerTransport routes parse failures to its
    // `onerror` callback rather than emitting a JSON-RPC parse-error frame;
    // the contract we care about is that the process stays healthy and the
    // next valid frame still gets a response.
    const child = spawn(process.execPath, [SERVER_PATH], {
      env: { ...process.env, WORK_TRACKER_DIR: dataDir },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (b) => { stdout += b.toString("utf8"); });

    child.stdin.write("this is not json\n");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`);
    child.stdin.end();
    const code = await new Promise((r) => child.on("close", r));

    assert.equal(code, 0, "server crashed on malformed input");
    const lines = stdout.split("\n").filter((l) => l.trim());
    const ping = lines.map((l) => JSON.parse(l)).find((m) => m.id === 1);
    assert.ok(ping?.result, `expected ping response after garbage frame, got ${stdout}`);
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
      // .strict() on every input schema → JSON Schema additionalProperties=false.
      assert.equal(
        tool.inputSchema.additionalProperties,
        false,
        `${tool.name} inputSchema should be strict (additionalProperties=false)`,
      );
      // Every tool exposes response_format.
      assert.ok(
        tool.inputSchema.properties.response_format,
        `${tool.name} missing response_format`,
      );
    }

    const save = tools.find((t) => t.name === "save_to_brag_sheet");
    assert.deepEqual(save.inputSchema.required, ["summary"]);
    assert.ok(save.inputSchema.properties.summary);
    assert.ok(save.inputSchema.properties.category);
    assert.ok(save.inputSchema.properties.tags);

    const review = tools.find((t) => t.name === "review_brag_sheet");
    assert.ok(review.inputSchema.properties.weeks, "review missing weeks");
    assert.ok(review.inputSchema.properties.limit, "review missing limit");
    assert.ok(review.inputSchema.properties.offset, "review missing offset");
  });

  it("advertises outputSchema and tool annotations for every tool", async () => {
    const { responses } = await runRpc([
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ]);
    const tools = responses[0].result.tools;

    for (const tool of tools) {
      assert.ok(tool.outputSchema, `${tool.name} missing outputSchema`);
      assert.equal(tool.outputSchema.type, "object", `${tool.name} outputSchema not an object`);
      assert.ok(tool.outputSchema.properties, `${tool.name} outputSchema missing properties`);
      assert.ok(tool.annotations, `${tool.name} missing annotations`);
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        assert.equal(typeof tool.annotations[hint], "boolean", `${tool.name}.${hint} should be boolean`);
      }
    }

    const save = tools.find((t) => t.name === "save_to_brag_sheet");
    assert.deepEqual(
      Object.keys(save.outputSchema.properties).sort(),
      ["category", "entryId", "success", "summary", "timestamp"],
    );

    const review = tools.find((t) => t.name === "review_brag_sheet");
    assert.equal(review.annotations.readOnlyHint, true);
    assert.equal(review.annotations.destructiveHint, false);
    assert.deepEqual(
      Object.keys(review.outputSchema.properties).sort(),
      ["count", "hasMore", "items", "nextOffset", "offset", "total", "weeksCovered"],
    );

    const generate = tools.find((t) => t.name === "generate_work_log");
    assert.equal(generate.annotations.destructiveHint, true);
    assert.deepEqual(
      Object.keys(generate.outputSchema.properties).sort(),
      ["bytesWritten", "outputPath", "recordCount", "success"],
    );
  });
});

describe("mcp-server: save_to_brag_sheet", () => {
  it("persists an entry record and returns a confirmation with structured output", async () => {
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
            impact: "Unblocks more MCP hosts",
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
    assert.ok(res.result.structuredContent, "missing structuredContent");
    assert.equal(res.result.structuredContent.success, true);
    assert.equal(res.result.structuredContent.category, "tooling");
    assert.equal(typeof res.result.structuredContent.entryId, "string");
    assert.equal(typeof res.result.structuredContent.timestamp, "string");

    const records = readRecords(dataDir, { type: "entry" });
    const matches = records.filter(
      (r) => r.summary === "Built the MCP server scaffold for cross-engine support",
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].category, "tooling");
    assert.deepEqual(matches[0].tags, ["mcp", "scaffold"]);
    assert.equal(matches[0].repo, "copilot-brag-sheet");
  });

  it("rejects missing summary at the validation layer (Zod-driven)", async () => {
    // The SDK validates the inputSchema before invoking the handler and
    // surfaces validation failures as a tool result with isError=true and
    // the JSON-RPC InvalidParams code (-32602) embedded in the text.
    const { responses } = await runRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "save_to_brag_sheet", arguments: {} },
      },
    ]);
    assert.equal(responses[0].result?.isError, true, JSON.stringify(responses[0]));
    assert.match(responses[0].result.content[0].text, /-32602|summary|required|invalid/i);
  });

  it("rejects unknown fields because every input schema is strict()", async () => {
    const { responses } = await runRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "save_to_brag_sheet",
          arguments: { summary: "ok", not_a_real_field: "boom" },
        },
      },
    ]);
    assert.equal(responses[0].result?.isError, true, JSON.stringify(responses[0]));
    assert.match(
      responses[0].result.content[0].text,
      /unrecognized|not_a_real_field|-32602/i,
    );
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

  it("emits JSON when response_format='json'", async () => {
    const { responses } = await runRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "save_to_brag_sheet",
          arguments: {
            summary: "Round-trip JSON output check",
            category: "documentation",
            response_format: "json",
          },
        },
      },
    ]);
    const res = responses[0].result;
    assert.ok(!res.isError, JSON.stringify(res));
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.success, true);
    assert.equal(parsed.category, "documentation");
    assert.equal(parsed.summary, "Round-trip JSON output check");
    assert.equal(typeof parsed.entryId, "string");
    assert.deepEqual(parsed, res.structuredContent);
  });
});

describe("mcp-server: review_brag_sheet", () => {
  it("returns a paginated envelope with markdown and structured items", async () => {
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
        params: { name: "review_brag_sheet", arguments: { weeks: 4, limit: 50 } },
      },
    ]);

    assert.equal(responses.length, 2);
    const review = responses.find((r) => r.id === 2).result;
    assert.ok(!review.isError);
    assert.match(review.content[0].text, /Review-test entry alpha/);
    assert.ok(review.structuredContent, "missing structuredContent");
    const sc = review.structuredContent;
    assert.equal(typeof sc.total, "number");
    assert.equal(typeof sc.count, "number");
    assert.equal(sc.offset, 0);
    assert.equal(sc.weeksCovered, 4);
    assert.equal(typeof sc.hasMore, "boolean");
    assert.ok(Array.isArray(sc.items));
    assert.ok(sc.items.length >= 1, "expected at least the alpha entry");
    assert.ok(sc.items.every((it) => typeof it.id === "string"), "items missing id");
  });

  it("respects limit and offset, and reports hasMore + nextOffset", async () => {
    // Seed a couple more entries so we have enough records to page through.
    const seeds = ["pager-alpha", "pager-beta", "pager-gamma"];
    const reqs = seeds.map((s, i) => ({
      jsonrpc: "2.0",
      id: 100 + i,
      method: "tools/call",
      params: {
        name: "save_to_brag_sheet",
        arguments: { summary: s, category: "documentation" },
      },
    }));
    reqs.push({
      jsonrpc: "2.0",
      id: 200,
      method: "tools/call",
      params: { name: "review_brag_sheet", arguments: { weeks: 4, limit: 2, offset: 0 } },
    });
    reqs.push({
      jsonrpc: "2.0",
      id: 201,
      method: "tools/call",
      params: { name: "review_brag_sheet", arguments: { weeks: 4, limit: 2, offset: 2 } },
    });

    const { responses } = await runRpc(reqs);
    const page1 = responses.find((r) => r.id === 200).result.structuredContent;
    const page2 = responses.find((r) => r.id === 201).result.structuredContent;

    assert.equal(page1.count, 2);
    assert.equal(page1.offset, 0);
    assert.equal(page1.hasMore, true);
    assert.equal(page1.nextOffset, 2);
    assert.ok(page1.total >= 4);

    assert.equal(page2.offset, 2);
    assert.ok(page2.count >= 1);
    // hasMore depends on the seeded entries from prior tests; just check the type.
    assert.equal(typeof page2.hasMore, "boolean");
  });

  it("emits raw JSON when response_format='json'", async () => {
    const { responses } = await runRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "review_brag_sheet",
          arguments: { weeks: 4, limit: 5, response_format: "json" },
        },
      },
    ]);
    const res = responses[0].result;
    assert.ok(!res.isError, JSON.stringify(res));
    const parsed = JSON.parse(res.content[0].text);
    assert.deepEqual(parsed, res.structuredContent);
    assert.equal(parsed.weeksCovered, 4);
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

    const gen = responses.find((r) => r.id === 2).result;
    assert.ok(!gen.isError, gen.content?.[0]?.text);
    assert.match(gen.content[0].text, /Work log generated/);
    assert.ok(existsSync(outputPath), `expected file at ${outputPath}`);
    const md = readFileSync(outputPath, "utf8");
    assert.ok(md.length > 0, "work log file is empty");
    const sc = gen.structuredContent;
    assert.equal(sc.success, true);
    assert.equal(sc.outputPath, outputPath);
    assert.equal(typeof sc.recordCount, "number");
    assert.equal(typeof sc.bytesWritten, "number");
    assert.ok(sc.bytesWritten > 0);
  });
});

describe("mcp-server: unknown tool", () => {
  it("returns a tool-error for an unknown tool name", async () => {
    // McpServer surfaces unknown-tool as a tool-result with isError=true and
    // the InvalidParams code (-32602) embedded in the text — the protocol
    // frame still has `result`, not `error`.
    const { responses } = await runRpc([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "does_not_exist", arguments: {} },
      },
    ]);
    assert.equal(responses[0].result?.isError, true, JSON.stringify(responses[0]));
    assert.match(responses[0].result.content[0].text, /not found|unknown|-32602/i);
  });
});

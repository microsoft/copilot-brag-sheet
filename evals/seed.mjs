#!/usr/bin/env node
/**
 * @fileoverview Seed deterministic brag-sheet entries for the MCP eval suite.
 *
 * Reads `evals/fixtures/entries.json`, computes a real timestamp for each entry
 * from its `daysAgo` offset, and writes the records into the data directory
 * specified by `WORK_TRACKER_DIR` (or the first CLI arg) using the same
 * `writeRecord` codepath the live server uses. The directory is wiped clean
 * first so reseeding produces a byte-identical state every run.
 *
 * Usage:
 *   WORK_TRACKER_DIR=/tmp/eval node evals/seed.mjs
 *   node evals/seed.mjs /tmp/eval
 *
 * After seeding, point the eval harness at the same WORK_TRACKER_DIR and run
 * `evals/brag-sheet.eval.xml`.
 */

import { readFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { writeRecord } from "../lib/storage.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const dataDir = process.env.WORK_TRACKER_DIR || process.argv[2];
if (!dataDir) {
  process.stderr.write(
    "[seed] missing target directory; pass WORK_TRACKER_DIR or argv[2]\n",
  );
  process.exit(1);
}

if (existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
}
mkdirSync(dataDir, { recursive: true });

const fixturePath = join(__dirname, "fixtures", "entries.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const now = Date.now();
let written = 0;

for (const item of fixture.entries) {
  const timestamp = new Date(now - item.daysAgo * 86400000).toISOString();
  const entry = {
    id: randomUUID(),
    type: "entry",
    source: "manual",
    timestamp,
    summary: item.summary,
    category: item.category,
    tags: item.tags ?? [],
    impact: item.impact ?? null,
    repo: item.repo ?? null,
    branch: item.branch ?? null,
    sessionId: null,
  };
  writeRecord(dataDir, entry);
  written += 1;
}

process.stdout.write(`[seed] wrote ${written} entries to ${dataDir}\n`);

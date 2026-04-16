import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown, renderReviewSummary, weekOf } from "../lib/render.mjs";

test("weekOf returns Monday for a Monday", () => {
  assert.equal(weekOf("2025-01-06T12:00:00Z"), "2025-01-06");
});

test("weekOf returns previous Monday for Sunday", () => {
  assert.equal(weekOf("2025-01-12T23:59:59Z"), "2025-01-06");
});

test("weekOf uses UTC consistently", () => {
  assert.equal(weekOf("2025-01-06T00:30:00+02:00"), "2024-12-30");
});

test("weekOf handles year boundary", () => {
  assert.equal(weekOf("2025-01-01T12:00:00Z"), "2024-12-30");
});

test("renderMarkdown returns header and markers for empty input", () => {
  const output = renderMarkdown([]);

  assert.match(output, /# Work Impact Log/);
  assert.match(output, /WEEKLY_ENTRIES_START/);
  assert.match(output, /WEEKLY_ENTRIES_END/);
  assert.doesNotMatch(output, /## Week of/);
});

test("renderMarkdown renders a single categorized entry", () => {
  const output = renderMarkdown([
    {
      type: "entry",
      timestamp: "2025-01-08T10:00:00Z",
      summary: "Shipped feature",
      category: "pr",
      impact: "Helped customers",
      repo: "copilot-brag-sheet"
    }
  ]);

  assert.match(output, /## Week of 2025-01-06/);
  assert.match(output, /### 🚀 PRs & Features/);
  assert.match(output, /- \*\*\[copilot-brag-sheet\] Shipped feature\*\* — Helped customers/);
});

test("renderMarkdown orders multiple weeks newest first", () => {
  const output = renderMarkdown([
    { type: "entry", timestamp: "2025-01-02T10:00:00Z", summary: "Older", category: "pr", impact: null, repo: null },
    { type: "entry", timestamp: "2025-01-15T10:00:00Z", summary: "Newer", category: "pr", impact: null, repo: null }
  ]);

  assert.ok(output.indexOf("## Week of 2025-01-13") < output.indexOf("## Week of 2024-12-30"));
});

test("renderMarkdown groups multiple categories", () => {
  const output = renderMarkdown([
    { type: "entry", timestamp: "2025-01-08T10:00:00Z", summary: "Feature", category: "pr", impact: null, repo: null },
    { type: "entry", timestamp: "2025-01-09T10:00:00Z", summary: "Bug", category: "bugfix", impact: null, repo: null }
  ]);

  assert.match(output, /### 🚀 PRs & Features/);
  assert.match(output, /### 🐛 Bug Fixes/);
});

test("renderMarkdown includes session log when opted in", () => {
  const output = renderMarkdown([
    {
      type: "session",
      timestamp: "2025-01-08T10:30:00Z",
      summary: "Investigated issue",
      category: null,
      repo: "copilot-brag-sheet",
      filesEdited: ["a", "b"],
      filesCreated: ["c"]
    }
  ], { includeSessionLog: true });

  assert.match(output, /### 📝 Session Activity Log/);
  assert.match(output, /\| Jan 8 10:30 \| Investigated issue \| copilot-brag-sheet \| 3 \|/);
});

test("renderMarkdown omits session log when opted out", () => {
  const output = renderMarkdown([
    {
      type: "session",
      timestamp: "2025-01-08T10:30:00Z",
      summary: "Investigated issue",
      category: null,
      repo: "copilot-brag-sheet",
      filesEdited: [],
      filesCreated: []
    }
  ]);

  assert.doesNotMatch(output, /Session Activity Log/);
});

test("renderMarkdown renders entries without category under Other section", () => {
  const output = renderMarkdown([
    { type: "entry", timestamp: "2025-01-08T10:00:00Z", summary: "No category", category: null, impact: null, repo: null }
  ]);

  assert.match(output, /### 📌 Other/);
  assert.match(output, /No category/);
});

test("renderMarkdown omits null repo and impact decorations", () => {
  const output = renderMarkdown([
    { type: "entry", timestamp: "2025-01-08T10:00:00Z", summary: "Plain item", category: "documentation", impact: null, repo: null }
  ]);

  assert.match(output, /- \*\*Plain item\*\*/);
  assert.doesNotMatch(output, /\[\]/);
  assert.doesNotMatch(output, /- \*\*Plain item\*\* — /);
});

test("renderMarkdown escapes pipes in session log table rows", () => {
  const output = renderMarkdown([
    {
      type: "session",
      timestamp: "2025-01-08T10:30:00Z",
      summary: "Pipe | summary",
      category: null,
      repo: "repo|name",
      filesEdited: ["a"],
      filesCreated: []
    }
  ], { includeSessionLog: true });

  assert.match(output, /\| Jan 8 10:30 \| Pipe \\| summary \| repo\\|name \| 1 \|/);
});

test("renderReviewSummary filters to requested week window", () => {
  const now = new Date();
  const recent = new Date(now);
  recent.setUTCDate(recent.getUTCDate() - 7);
  const old = new Date(now);
  old.setUTCDate(old.getUTCDate() - 50);

  const output = renderReviewSummary([
    {
      type: "entry",
      timestamp: recent.toISOString(),
      summary: "Recent",
      category: "pr",
      impact: null,
      repo: null
    },
    {
      type: "entry",
      timestamp: old.toISOString(),
      summary: "Old",
      category: "pr",
      impact: null,
      repo: null
    }
  ], { weeks: 4 });

  assert.match(output, /Recent/);
  assert.doesNotMatch(output, /Old/);
});

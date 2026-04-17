import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_CONFIG,
  getAllCategoryIds,
  getCategoryById,
  getCategoryEmoji,
  isValidCategory,
  loadConfig,
  buildUserContext
} from "../lib/config.mjs";

function createTempDir() {
  return mkdtempSync(join(process.cwd(), "test-temp-config-"));
}

test("loadConfig returns defaults when config.json is missing", () => {
  const tempDir = createTempDir();

  try {
    const config = loadConfig(tempDir);
    assert.deepEqual(config, DEFAULT_CONFIG);
    assert.notEqual(config, DEFAULT_CONFIG);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig deep merges partial config and appends categories", () => {
  const tempDir = createTempDir();

  try {
    writeFileSync(
      join(tempDir, "config.json"),
      JSON.stringify({
        categories: [{ id: "security", emoji: "🔒", label: "Security" }],
        output: { includeSessionLog: true },
        git: { enabled: true, push: true }
      })
    );

    const config = loadConfig(tempDir);
    const securityCategory = getCategoryById(config, "security");

    assert.equal(config.output.includeSessionLog, true);
    assert.equal(config.output.defaultFormat, "bullets");
    assert.deepEqual(config.git, { enabled: true, push: true });
    assert.equal(config.categories.length, DEFAULT_CONFIG.categories.length + 1);
    assert.deepEqual(securityCategory, { id: "security", emoji: "🔒", label: "Security" });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig returns defaults on invalid JSON", () => {
  const tempDir = createTempDir();

  try {
    writeFileSync(join(tempDir, "config.json"), "{ invalid json");

    const config = loadConfig(tempDir);

    assert.deepEqual(config, DEFAULT_CONFIG);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("category lookup helpers return expected values", () => {
  const tempDir = createTempDir();

  try {
    const config = loadConfig(tempDir);

    assert.deepEqual(getCategoryById(config, "pr"), DEFAULT_CONFIG.categories[0]);
    assert.equal(getCategoryEmoji(config, "bugfix"), "🐛");
    assert.equal(isValidCategory(config, "design"), true);
    assert.equal(isValidCategory(config, "unknown"), false);
    assert.deepEqual(getAllCategoryIds(config), DEFAULT_CONFIG.categories.map((category) => category.id));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("DEFAULT_CONFIG includes preset field", () => {
  assert.equal(DEFAULT_CONFIG.preset, null);
});

test("loadConfig applies microsoft preset defaults", () => {
  const tempDir = createTempDir();
  try {
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      preset: "microsoft"
    }));
    const config = loadConfig(tempDir);
    assert.equal(config.preset, "microsoft");
    assert.equal(config.output.includeSessionLog, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("microsoft preset does not override explicit includeSessionLog=false", () => {
  const tempDir = createTempDir();
  try {
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      preset: "microsoft",
      output: { includeSessionLog: false }
    }));
    const config = loadConfig(tempDir);
    assert.equal(config.preset, "microsoft");
    assert.equal(config.output.includeSessionLog, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildUserContext returns null for default config", () => {
  const config = loadConfig(createTempDir());
  assert.equal(buildUserContext(config), null);
});

test("buildUserContext returns Microsoft context when preset is set", () => {
  const tempDir = createTempDir();
  try {
    writeFileSync(join(tempDir, "config.json"), JSON.stringify({
      preset: "microsoft"
    }));
    const config = loadConfig(tempDir);
    const ctx = buildUserContext(config);
    assert.ok(ctx.includes("Microsoft employee"));
    assert.ok(ctx.includes("Connect"));
    assert.ok(ctx.includes("Did X"));
    assert.ok(ctx.includes("ADO"));
    assert.ok(ctx.includes("ICM"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

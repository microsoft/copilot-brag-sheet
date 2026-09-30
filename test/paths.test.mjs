import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  detectBragSheetPath,
  detectDataDir,
  detectGitConfig,
  ensureDir,
  resolveHookWorkingDirectory
} from "../lib/paths.mjs";

function withEnv(overrides, fn) {
  const originalValues = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    originalValues.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of originalValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createTempDir() {
  return mkdtempSync(join(process.cwd(), "test-temp-paths-"));
}

test("detectDataDir honors WORK_TRACKER_DIR override", () => {
  const tempDir = createTempDir();

  try {
    const dataDir = withEnv(
      {
        WORK_TRACKER_DIR: ".\\relative-tracker-dir",
        WORK_TRACKER_TEST_PLATFORM: "win32"
      },
      () => detectDataDir()
    );

    assert.equal(dataDir, resolve(".\\relative-tracker-dir"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("detectDataDir resolves Windows path", () => {
  const tempDir = createTempDir();

  try {
    const localAppData = join(tempDir, "LocalAppData");
    const dataDir = withEnv(
      {
        WORK_TRACKER_DIR: undefined,
        WORK_TRACKER_TEST_PLATFORM: "win32",
        LOCALAPPDATA: localAppData,
        XDG_DATA_HOME: undefined
      },
      () => detectDataDir()
    );

    assert.equal(dataDir, resolve(localAppData, "copilot-brag-sheet"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("detectDataDir resolves macOS path", () => {
  const tempDir = createTempDir();

  try {
    const homeDir = join(tempDir, "home");
    const dataDir = withEnv(
      {
        WORK_TRACKER_DIR: undefined,
        WORK_TRACKER_TEST_PLATFORM: "darwin",
        HOME: homeDir,
        USERPROFILE: homeDir,
        LOCALAPPDATA: undefined,
        XDG_DATA_HOME: undefined
      },
      () => detectDataDir()
    );

    assert.equal(
      dataDir,
      resolve(homeDir, "Library", "Application Support", "copilot-brag-sheet")
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("detectDataDir resolves Linux path with XDG fallback", () => {
  const tempDir = createTempDir();

  try {
    const xdgDataHome = join(tempDir, "xdg-data");
    const dataDir = withEnv(
      {
        WORK_TRACKER_DIR: undefined,
        WORK_TRACKER_TEST_PLATFORM: "linux",
        XDG_DATA_HOME: xdgDataHome,
        LOCALAPPDATA: undefined
      },
      () => detectDataDir()
    );

    assert.equal(dataDir, resolve(xdgDataHome, "copilot-brag-sheet"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("detectBragSheetPath honors override and defaults to data dir", () => {
  const tempDir = createTempDir();

  try {
    // New env var name (preferred)
    const overridePath = withEnv(
      { WORK_TRACKER_OUTPUT_PATH: ".\\custom-log.md", WORK_TRACKER_BRAG_SHEET: undefined },
      () => detectBragSheetPath(join(tempDir, "data"))
    );
    // Legacy env var name (backward compat)
    const legacyPath = withEnv(
      { WORK_TRACKER_OUTPUT_PATH: undefined, WORK_TRACKER_BRAG_SHEET: ".\\legacy-log.md" },
      () => detectBragSheetPath(join(tempDir, "data"))
    );
    // Default when neither is set
    const defaultPath = withEnv(
      { WORK_TRACKER_OUTPUT_PATH: undefined, WORK_TRACKER_BRAG_SHEET: undefined },
      () => detectBragSheetPath(join(tempDir, "data"))
    );

    assert.equal(overridePath, resolve(".\\custom-log.md"));
    assert.equal(legacyPath, resolve(".\\legacy-log.md"));
    assert.equal(defaultPath, join(tempDir, "data", "work-log.md"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("detectGitConfig resolves enabled and push settings", () => {
  const tempDir = createTempDir();

  try {
    const enabledConfig = withEnv(
      {
        WORK_TRACKER_GIT_BACKUP: "true",
        WORK_TRACKER_GIT_PUSH: undefined
      },
      () => detectGitConfig()
    );

    const enabledWithPush = withEnv(
      {
        WORK_TRACKER_GIT_BACKUP: "true",
        WORK_TRACKER_GIT_PUSH: "true"
      },
      () => detectGitConfig()
    );

    const disabledConfig = withEnv(
      {
        WORK_TRACKER_GIT_BACKUP: "false",
        WORK_TRACKER_GIT_PUSH: undefined
      },
      () => detectGitConfig()
    );

    assert.deepEqual(enabledConfig, { enabled: true, push: false });
    assert.deepEqual(enabledWithPush, { enabled: true, push: true });
    assert.deepEqual(disabledConfig, { enabled: false, push: false });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ensureDir creates directories recursively", () => {
  const tempDir = createTempDir();
  const nestedDir = join(tempDir, "a", "b", "c");

  try {
    ensureDir(nestedDir);
    assert.equal(existsSync(nestedDir), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveHookWorkingDirectory prefers the current SDK field", () => {
  assert.equal(
    resolveHookWorkingDirectory({
      workingDirectory: "C:\\current",
      cwd: "C:\\legacy",
    }),
    resolve("C:\\current"),
  );
});

test("resolveHookWorkingDirectory supports legacy cwd payloads", () => {
  assert.equal(
    resolveHookWorkingDirectory({ cwd: "C:\\legacy" }),
    resolve("C:\\legacy"),
  );
});

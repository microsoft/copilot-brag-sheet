import { join, resolve, isAbsolute } from "node:path";
import { homedir, platform } from "node:os";
import { existsSync, mkdirSync } from "node:fs";

function resolveAbsolute(targetPath) {
  if (!targetPath) {
    return "";
  }

  return isAbsolute(targetPath) ? targetPath : resolve(targetPath);
}

function getPlatform() {
  return process.env.WORK_TRACKER_TEST_PLATFORM || platform();
}

export function detectDataDir() {
  if (process.env.WORK_TRACKER_DIR) {
    return resolveAbsolute(process.env.WORK_TRACKER_DIR);
  }

  const currentPlatform = getPlatform();

  if (currentPlatform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return resolve(localAppData, "copilot-brag-sheet");
  }

  if (currentPlatform === "darwin") {
    return resolve(homedir(), "Library", "Application Support", "copilot-brag-sheet");
  }

  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return resolve(dataHome, "copilot-brag-sheet");
}

export function detectBragSheetPath(dataDir) {
  const override = process.env.WORK_TRACKER_OUTPUT_PATH
    || process.env.WORK_TRACKER_BRAG_SHEET;
  if (override) {
    return resolveAbsolute(override);
  }

  return join(dataDir, "work-log.md");
}

export function detectGitConfig() {
  // Legacy env var support (backward compat with v1)
  if (process.env.WORK_TRACKER_GIT_BACKUP === "true") {
    return {
      enabled: true,
      push: Boolean(process.env.WORK_TRACKER_GIT_PUSH === "true")
    };
  }

  return { enabled: false, push: false };
}

export function resolveHookWorkingDirectory(input, fallback = process.cwd()) {
  return resolve(input?.workingDirectory || input?.cwd || fallback);
}

export function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

export { resolveAbsolute };

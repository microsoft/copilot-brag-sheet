#!/usr/bin/env node

/**
 * Install copilot-brag-sheet from npm — copies extension files to ~/.copilot/extensions/
 * and runs the interactive setup wizard.
 *
 * This is what `copilot-brag-sheet` runs when invoked via:
 *   npm install -g copilot-brag-sheet
 *   copilot-brag-sheet
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, ".."); // bin/ → package root

const COPILOT_HOME =
  process.env.COPILOT_HOME ?? join(homedir(), ".copilot");
const TARGET_DIR = join(COPILOT_HOME, "extensions", "copilot-brag-sheet");

// ── Helpers ─────────────────────────────────────────────────────────────────
function green(s) { return `\x1b[32m${s}\x1b[0m`; }
function bold(s) { return `\x1b[1m${s}\x1b[0m`; }
function dim(s) { return `\x1b[2m${s}\x1b[0m`; }

// ── Preflight ───────────────────────────────────────────────────────────────
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 18) {
  console.error(`Node.js 18+ required (found v${process.versions.node})`);
  process.exit(1);
}

// Verify the package source has the files we expect
const REQUIRED = ["extension.mjs", "package.json", "plugin.json", "lib", "bin"];
const missing = REQUIRED.filter((p) => !existsSync(join(PKG_ROOT, p)));
if (missing.length) {
  console.error(`Package missing required files: ${missing.join(", ")}`);
  console.error(`  Looked in: ${PKG_ROOT}`);
  process.exit(1);
}

// ── Install ─────────────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
console.log(`\n${bold(`Installing copilot-brag-sheet v${pkg.version}...`)}\n`);

if (existsSync(TARGET_DIR)) {
  rmSync(TARGET_DIR, { recursive: true, force: true });
}
mkdirSync(TARGET_DIR, { recursive: true });

// Copy package contents (excluding node_modules + .git + tests)
const SKIP = new Set([
  "node_modules", ".git", ".github", "test", "docs",
  "AGENTS.md", "CONTRIBUTING.md", "ROADMAP.md", "CODEOWNERS",
  "CHANGELOG.md", "CODE_OF_CONDUCT.md", "SECURITY.md",
  "install.sh", "install.ps1",
]);
for (const entry of REQUIRED) {
  cpSync(join(PKG_ROOT, entry), join(TARGET_DIR, entry), { recursive: true });
}
// Also copy README + LICENSE if present (npm tarball includes them)
for (const opt of ["README.md", "LICENSE"]) {
  const src = join(PKG_ROOT, opt);
  if (existsSync(src)) cpSync(src, join(TARGET_DIR, opt));
}

console.log(green(`  ✅ Extension installed to ${TARGET_DIR}`));

// ── Run setup wizard if interactive ─────────────────────────────────────────
const setupScript = join(TARGET_DIR, "bin", "setup.mjs");

if (process.stdin.isTTY && existsSync(setupScript)) {
  console.log("");
  const result = spawnSync(process.execPath, [setupScript], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 0);
} else {
  console.log("");
  console.log(green(bold("🎉 Installed!")));
  console.log("");
  console.log("  Next steps:");
  console.log(`    1. Run the setup wizard:  node ${setupScript}`);
  console.log("    2. Run /clear in Copilot CLI (or restart it)");
  console.log("    3. Say \"brag\" to save an accomplishment");
  console.log("");
}

// Silence unused import warning (kept for potential future use in setup-import)
void pathToFileURL;

import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

it("locked package downloads use public npm without URL credentials", () => {
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  for (const [name, pkg] of Object.entries(lock.packages)) {
    if (!name) continue;
    assert.ok(pkg.resolved, `Missing download URL: ${name}`);
    const url = new URL(pkg.resolved);
    assert.ok(url.origin === "https://registry.npmjs.org", `Non-public download source: ${name}`);
    assert.ok(!url.username && !url.password && !url.search && !url.hash, `Unexpected URL credentials or parameters: ${name}`);
    assert.ok(pkg.integrity, `Missing package integrity: ${name}`);
  }
});

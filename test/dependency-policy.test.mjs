import { it } from "node:test";
import assert from "node:assert/strict";
import { assessDependencyPatch } from "../.github/scripts/dependency-policy.mjs";

function fixture() {
  const manifest = { name: "example", version: "1.0.0", engines: { node: ">=22.0.0" },
    scripts: { test: "node --test" }, dependencies: { zod: "4.6.7" } };
  const lock = { name: "example", version: "1.0.0", lockfileVersion: 3, packages: {
    "": structuredClone(manifest),
    "node_modules/zod": { version: "4.6.7", resolved: "https://registry.npmjs.org/zod/-/zod-4.6.7.tgz", integrity: "sha512-old", engines: { node: ">=18" } },
    "node_modules/helper": { version: "1.2.3", resolved: "https://registry.npmjs.org/helper/-/helper-1.2.3.tgz", integrity: "sha512-helper" },
  } };
  const before = { manifest, lock };
  const after = structuredClone(before);
  after.manifest.dependencies.zod = "4.6.8";
  after.lock.packages[""].dependencies.zod = "4.6.8";
  Object.assign(after.lock.packages["node_modules/zod"], {
    version: "4.6.8", resolved: "https://registry.npmjs.org/zod/-/zod-4.6.8.tgz", integrity: "sha512-new",
  });
  return { before, after };
}

it("accepts a direct dependency patch without other changes", () => {
  const { before, after } = fixture();
  assert.equal(assessDependencyPatch(before, after).eligible, true);
});

it("accepts a lockfile-only transitive patch", () => {
  const { before } = fixture();
  const after = structuredClone(before);
  Object.assign(after.lock.packages["node_modules/helper"], {
    version: "1.2.4", resolved: "https://registry.npmjs.org/helper/-/helper-1.2.4.tgz", integrity: "sha512-new",
  });
  assert.equal(assessDependencyPatch(before, after).eligible, true);
});

for (const [name, mutate] of [
  ["minor transitive upgrade hidden in a direct patch", a => { a.lock.packages["node_modules/helper"].version = "1.3.0"; }],
  ["runtime requirement change", a => { a.manifest.engines.node = ">=24"; }],
  ["install script change", a => { a.manifest.scripts.postinstall = "node install.mjs"; }],
  ["new dependency", a => { a.manifest.dependencies.extra = "1.0.0"; }],
  ["removed locked dependency", a => { delete a.lock.packages["node_modules/helper"]; }],
  ["new transitive install script", a => { a.lock.packages["node_modules/zod"].hasInstallScript = true; }],
  ["transitive engine change", a => { a.lock.packages["node_modules/zod"].engines.node = ">=24"; }],
  ["non-public download", a => { a.lock.packages["node_modules/zod"].resolved = "https://example.com/zod.tgz"; }],
  ["URL credentials", a => { a.lock.packages["node_modules/zod"].resolved = "https://user:password@registry.npmjs.org/zod/-/zod-4.6.8.tgz"; }],
  ["same-version integrity replacement", a => { a.lock.packages["node_modules/helper"].integrity = "sha512-replaced"; }],
  ["manifest and lock disagreement", a => { a.lock.packages[""].dependencies.zod = "4.6.9"; }],
  ["prerelease", a => { a.lock.packages["node_modules/zod"].version = "4.6.8-beta.1"; }],
  ["downgrade", a => { a.lock.packages["node_modules/zod"].version = "4.6.6"; }],
  ["missing integrity", a => { delete a.lock.packages["node_modules/zod"].integrity; }],
]) {
  it(`rejects ${name}`, () => {
    const { before, after } = fixture();
    mutate(after);
    assert.equal(assessDependencyPatch(before, after).eligible, false);
  });
}

it("does not merge a no-op update", () => {
  const { before } = fixture();
  assert.equal(assessDependencyPatch(before, before).eligible, false);
});

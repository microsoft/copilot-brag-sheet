import { isDeepStrictEqual as equal } from "node:util";

const omit = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
const sameKeys = (a, b) => equal(Object.keys(a).sort(), Object.keys(b).sort());

function patchIncrease(before, after) {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stable.test(before) || !stable.test(after)) return false;
  const a = before.split(".").map(Number);
  const b = after.split(".").map(Number);
  return [...a, ...b].every(Number.isSafeInteger) && a[0] === b[0] && a[1] === b[1] && b[2] > a[2];
}

export function assessDependencyPatch(before, after) {
  const require = (condition, reason) => { if (!condition) throw new Error(reason); };
  try {
    require(equal(omit(before.manifest, ["dependencies"]), omit(after.manifest, ["dependencies"])),
      "Manifest settings outside runtime dependency versions changed.");
    const oldDeps = before.manifest.dependencies;
    const newDeps = after.manifest.dependencies;
    require(sameKeys(oldDeps, newDeps), "The direct dependency set changed.");
    for (const name of Object.keys(oldDeps)) {
      require(["@modelcontextprotocol/sdk", "zod"].includes(name), "A direct dependency requires maintainer review.");
      require(oldDeps[name] === newDeps[name] || patchIncrease(oldDeps[name], newDeps[name]),
        "A direct dependency change is not a stable patch upgrade.");
      require(after.lock.packages[`node_modules/${name}`].version === newDeps[name],
        "The manifest and installed dependency versions disagree.");
    }
    require(equal(omit(before.lock, ["packages"]), omit(after.lock, ["packages"])),
      "Lockfile settings changed.");
    require(sameKeys(before.lock.packages, after.lock.packages), "The locked dependency set changed.");
    require(equal(omit(before.lock.packages[""], ["dependencies"]), omit(after.lock.packages[""], ["dependencies"])),
      "Root lockfile settings changed.");
    require(equal(after.lock.packages[""].dependencies, newDeps), "Manifest and lockfile dependencies disagree.");
    let updates = 0;
    for (const [location, pkg] of Object.entries(after.lock.packages)) {
      if (!location) continue;
      const old = before.lock.packages[location];
      const name = pkg.name || location.split("node_modules/").at(-1);
      const basename = name.split("/").at(-1);
      require(pkg.resolved === `https://registry.npmjs.org/${name}/-/${basename}-${pkg.version}.tgz`,
        "A locked download is not the canonical public npm tarball.");
      require(typeof pkg.integrity === "string" && /^sha(?:512|384|256|1)-[A-Za-z0-9+/=]+$/.test(pkg.integrity),
        "A locked dependency has no valid integrity field.");
      if (equal(old, pkg)) continue;
      require(patchIncrease(old.version, pkg.version), "A locked dependency change is not a stable patch upgrade.");
      require(equal(omit(old, ["version", "resolved", "integrity"]), omit(pkg, ["version", "resolved", "integrity"])),
        "Dependency metadata, runtime requirements, or installation behavior changed.");
      updates++;
    }
    require(updates > 0, "No dependency patch upgrade was found.");
    return { eligible: true, reason: "Only stable dependency patch versions and their tarballs changed." };
  } catch (error) {
    return { eligible: false, reason: error instanceof TypeError ? "Dependency metadata is incomplete." : error.message };
  }
}

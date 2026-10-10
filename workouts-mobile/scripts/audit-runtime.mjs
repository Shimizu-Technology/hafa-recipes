import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Exact reviewed dependency tree: any lock change requires renewed reachability
// assessment. These are temporary documented exceptions, not security fixes.
const reviewedLock = "85ccf9df501a5ac0a4179a91fe165776a775d07dfae00d146c873af2bc6cb6f4";
const reviewed = new Set(["braces:1240992", "decode-uri-component:1147955", "node-forge:1240912", "stream-json:1164823", "stream-json:1241262", "stream-json:1241263"]);
const lock = readFileSync(new URL("../package-lock.json", import.meta.url));
const now = Date.now();
if (createHash("sha256").update(lock).digest("hex") !== reviewedLock || now < Date.parse("2026-10-10T00:00:00Z") || now >= Date.parse("2026-11-03T00:00:00Z")) {
  throw new Error("Workouts dependency review changed or expired; renew NATIVE_DEPENDENCY_REACHABILITY.md before accepting inherited findings.");
}
const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 20*1024*1024 });
if (result.error || ![0,1].includes(result.status)) throw new Error("Dependency audit did not complete");
const report = JSON.parse(result.stdout);
if (report.error || !report.metadata?.vulnerabilities || !report.vulnerabilities) throw new Error("Dependency audit returned no valid report");
const unexpected = [];
for (const [name, finding] of Object.entries(report.vulnerabilities)) {
  for (const via of finding.via ?? []) {
    if (typeof via === "object" && !reviewed.has(`${name}:${via.source}`)) unexpected.push(`${name}:${via.source} ${via.severity} ${via.title}`);
  }
}
if (report.metadata.vulnerabilities.critical || unexpected.length) throw new Error(`Unexpected dependency advisories: ${unexpected.join("; ")}`);
console.log(`Workouts audit: ${report.metadata.vulnerabilities.total} inherited findings; ${reviewed.size} reviewed advisories;0 unexpected. Temporary reachability exceptions expire2026-11-03.`);

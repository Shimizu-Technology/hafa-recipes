import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Exact reviewed dependency tree: any lock change requires renewed reachability
// assessment. These are temporary documented exceptions, not security fixes.
const reviewedLock = "422b3e8456b1b454c92a4ae2a753f7c247173a635cd39def3e0ef087df28f779";
// Expo CLI/config/fingerprint and Metro file matching; absent from native bundles.
const reviewed = new Set(["decode-uri-component:1147955", "decode-uri-component:1243857", "glob:1244013", "minimatch:1244623"]);
const lock = readFileSync(new URL("../package-lock.json", import.meta.url));
const now = Date.now();
if (createHash("sha256").update(lock).digest("hex") !== reviewedLock || now < Date.parse("2026-10-24T00:00:00Z") || now >= Date.parse("2027-01-15T00:00:00Z")) {
  throw new Error("Baby dependency review changed or expired; renew baby-mobile/README.md before accepting inherited findings.");
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
console.log(`Baby audit: ${report.metadata.vulnerabilities.total} inherited findings; ${reviewed.size} reviewed advisories;0 unexpected. Temporary reachability exceptions expire 2027-01-15.`);

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Exact reviewed dependency tree: any lock change requires renewed reachability
// assessment. These are temporary documented exceptions, not security fixes.
const reviewedLock = "f74572e20331ac9d4f5f1fcc43303a39e0637e9167a1aef09e131ab6a18adf6b";
const reviewed = new Set(["braces:1240992", "decode-uri-component:1147955", "decode-uri-component:1243857", "deepmerge:1243505", "node-forge:1240912", "zod:1243066"]);
const lock = readFileSync(new URL("../package-lock.json", import.meta.url));
const now = Date.now();
if (createHash("sha256").update(lock).digest("hex") !== reviewedLock || now < Date.parse("2026-10-24T00:00:00Z") || now >= Date.parse("2026-11-17T00:00:00Z")) {
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
console.log(`Baby audit: ${report.metadata.vulnerabilities.total} inherited findings; ${reviewed.size} reviewed advisories;0 unexpected. Temporary reachability exceptions expire2026-11-17.`);

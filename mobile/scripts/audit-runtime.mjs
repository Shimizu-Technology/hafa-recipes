import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { isAcceptedAdvisory, reviewedAdvisoryCount } from './audit-policy.mjs';

const lockfile = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
);

const audit = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error(audit.stderr || 'npm audit did not return a JSON report');
  process.exit(1);
}

const unexpected = [];
for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
  for (const advisory of vulnerability.via ?? []) {
    if (typeof advisory !== 'object') continue;
    const key = `${packageName}:${advisory.source}`;
    if (!isAcceptedAdvisory({ packageName, source: advisory.source, lockfile })) {
      unexpected.push(`${key} (${advisory.severity}) ${advisory.title}`);
    }
  }
}

const counts = report.metadata?.vulnerabilities ?? {};
if ((counts.critical ?? 0) > 0 || unexpected.length > 0) {
  console.error('Unexpected mobile production dependency advisories:');
  for (const item of unexpected) console.error(`- ${item}`);
  process.exit(1);
}

console.log(
  `Mobile audit checked: ${counts.total ?? 0} inherited findings, ` +
    `${reviewedAdvisoryCount} reviewed upstream advisories, 0 unexpected.`,
);

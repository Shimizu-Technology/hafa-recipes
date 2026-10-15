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

function invalidReport() {
  console.error('Mobile production audit could not be verified; npm returned an incomplete or failed report.');
  process.exit(1);
}
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
if (audit.error || audit.signal || ![0, 1].includes(audit.status)) invalidReport();

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  invalidReport();
}
if (!object(report) || Object.hasOwn(report, 'error') || report.auditReportVersion !== 2
  || !object(report.vulnerabilities) || !object(report.metadata?.vulnerabilities)) invalidReport();

const counts = report.metadata.vulnerabilities;
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
if (![...severities, 'total'].every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) invalidReport();
const actual = Object.fromEntries(severities.map((severity) => [severity, 0]));
for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
  if (!name || !object(vulnerability) || !severities.includes(vulnerability.severity)
    || !Array.isArray(vulnerability.via) || vulnerability.via.length === 0) invalidReport();
  actual[vulnerability.severity]++;
  for (const advisory of vulnerability.via) {
    if (typeof advisory === 'string') {
      if (!advisory || !Object.hasOwn(report.vulnerabilities, advisory)) invalidReport();
    } else if (!object(advisory) || !Number.isSafeInteger(advisory.source) || advisory.source <= 0
      || !severities.includes(advisory.severity) || typeof advisory.title !== 'string' || !advisory.title
      || severities.indexOf(advisory.severity) > severities.indexOf(vulnerability.severity)) invalidReport();
  }
}
if (severities.some((key) => counts[key] !== actual[key])
  || severities.reduce((sum, key) => sum + counts[key], 0) !== counts.total
  || audit.status === 1 && counts.total === 0) invalidReport();

const unexpected = [];
for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities)) {
  for (const advisory of vulnerability.via ?? []) {
    if (typeof advisory !== 'object') continue;
    const key = `${packageName}:${advisory.source}`;
    if (!isAcceptedAdvisory({ packageName, source: advisory.source, lockfile })) {
      unexpected.push(`${key} (${advisory.severity}) ${advisory.title}`);
    }
  }
}

if (counts.critical > 0 || unexpected.length > 0) {
  console.error('Unexpected mobile production dependency advisories:');
  for (const item of unexpected) console.error(`- ${item}`);
  process.exit(1);
}

console.log(
  `Mobile audit checked: ${counts.total} inherited findings, ` +
    `${reviewedAdvisoryCount} reviewed upstream advisories, 0 unexpected.`,
);

console.log(`Mobile audit severity counts: ${severities.map((key) => `${key}=${counts[key]}`).join(', ')}.`);

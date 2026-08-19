import { spawnSync } from 'node:child_process';

const acceptedUpstreamAdvisories = new Set([
  // Expo/Metro build-time image metadata parsing; app inputs do not reach it.
  'image-size:1138808',
  'image-size:1138809',
  // Expo/Metro CSS build pipeline; only trusted repository CSS is processed.
  'postcss:1117015',
  'postcss:1124252',
  'postcss:1130709',
  'postcss:1139510',
  // Build tooling and Clerk's unused wallet dependency path; app code does not
  // call UUID v3/v5/v6 with caller-controlled output buffers.
  'uuid:1119441',
]);

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
    if (!acceptedUpstreamAdvisories.has(key)) {
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
    `${acceptedUpstreamAdvisories.size} reviewed upstream advisories, 0 unexpected.`,
);

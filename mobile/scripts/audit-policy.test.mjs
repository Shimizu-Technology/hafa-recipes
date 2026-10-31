import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { isAcceptedAdvisory } from './audit-policy.mjs';

const lockfile = JSON.parse(
  readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
);

const streamJsonAdvisory = {
  packageName: 'stream-json',
  source: 1164823,
};

describe('mobile runtime audit policy', () => {
  it('accepts the reviewed Clerk wallet dependency at its locked version', () => {
    expect(isAcceptedAdvisory({ ...streamJsonAdvisory, lockfile })).toBe(true);
  });

  it('rejects the same advisory when another production path uses the package', () => {
    const changedLockfile = structuredClone(lockfile);
    changedLockfile.packages[''].dependencies['stream-json'] = '1.9.1';

    expect(isAcceptedAdvisory({
      ...streamJsonAdvisory,
      lockfile: changedLockfile,
    })).toBe(false);
  });

  it('rejects an unreviewed stream-json version', () => {
    const changedLockfile = structuredClone(lockfile);
    changedLockfile.packages['node_modules/stream-json'].version = '1.9.2';

    expect(isAcceptedAdvisory({
      ...streamJsonAdvisory,
      lockfile: changedLockfile,
    })).toBe(false);
  });

  it('rejects a changed intermediate package even when its edges are unchanged', () => {
    const changedLockfile = structuredClone(lockfile);
    changedLockfile.packages['node_modules/jayson'].version = '4.3.1';

    expect(isAcceptedAdvisory({
      ...streamJsonAdvisory,
      lockfile: changedLockfile,
    })).toBe(false);
  });
});

const reviewedAt = Date.parse('2026-10-24T12:00:00Z');
const buildToolAdvisories = [
  { packageName: 'decode-uri-component', source: 1243857, parent: 'node_modules/query-string' },
  { packageName: 'deepmerge', source: 1243505, parent: 'node_modules/@expo/config' },
  { packageName: 'zod', source: 1243066, parent: 'node_modules/abitype' },
  { packageName: 'braces', source: 1240992, parent: 'node_modules/micromatch' },
  { packageName: 'glob', source: 1244013, parent: 'node_modules/@expo/cli' },
  { packageName: 'minimatch', source: 1244012, parent: 'node_modules/glob' },
];

describe.each(buildToolAdvisories)('$packageName temporary dependency review', (advisory) => {
  function accepted(changedLockfile = lockfile, now = reviewedAt, source = advisory.source) {
    return isAcceptedAdvisory({ ...advisory, source, lockfile: changedLockfile, now });
  }

  it('accepts only the reviewed tree before its existing expiry', () => {
    expect(accepted()).toBe(true);
    expect(accepted(lockfile, Date.parse('2026-11-16T23:59:59.999Z'))).toBe(true);
  });

  it('rejects expiry, dates before review, and invalid clocks', () => {
    for (const now of [Date.parse('2026-11-17T00:00:00Z'), Date.parse('2026-10-03T23:59:59Z'), NaN]) {
      expect(accepted(lockfile, now)).toBe(false);
    }
  });

  it('rejects missing locks and changed advisory IDs', () => {
    expect(accepted({}, reviewedAt)).toBe(false);
    expect(accepted(lockfile, reviewedAt, advisory.source + 1)).toBe(false);
  });

  it.each(['version', 'integrity'])('rejects changed package %s', (field) => {
    const changed = structuredClone(lockfile);
    changed.packages[`node_modules/${advisory.packageName}`][field] += '-changed';
    expect(accepted(changed)).toBe(false);
  });

  it.each(['version', 'integrity'])('rejects changed declaring-parent %s', (field) => {
    const changed = structuredClone(lockfile);
    changed.packages[advisory.parent][field] += '-changed';
    expect(accepted(changed)).toBe(false);
  });

  it('rejects an additional application or transitive declaring parent', () => {
    for (const parent of ['', 'node_modules/new-runtime-library']) {
      const changed = structuredClone(lockfile);
      changed.packages[parent] ??= { version: '1.0.0', integrity: 'sha512-new' };
      changed.packages[parent].dependencies ??= {};
      changed.packages[parent].dependencies[advisory.packageName] = '*';
      expect(accepted(changed)).toBe(false);
    }
  });

  it('rejects changed dependency ranges and dependency kinds', () => {
    const rangeChanged = structuredClone(lockfile);
    const kind = advisory.packageName === 'zod' ? 'peerDependencies' : 'dependencies';
    rangeChanged.packages[advisory.parent][kind][advisory.packageName] = '*';
    expect(accepted(rangeChanged)).toBe(false);
    const kindChanged = structuredClone(lockfile);
    kindChanged.packages[advisory.parent].optionalDependencies = {
      [advisory.packageName]: kindChanged.packages[advisory.parent][kind][advisory.packageName],
    };
    delete kindChanged.packages[advisory.parent][kind][advisory.packageName];
    expect(accepted(kindChanged)).toBe(false);
  });

  it('rejects a nested duplicate even with the reviewed version/integrity', () => {
    const changed = structuredClone(lockfile);
    changed.packages[`node_modules/new-parent/node_modules/${advisory.packageName}`] =
      structuredClone(changed.packages[`node_modules/${advisory.packageName}`]);
    expect(accepted(changed)).toBe(false);
  });
});

it('rejects a newly declared micromatch runtime path for the braces exception', () => {
  const changed = structuredClone(lockfile);
  changed.packages[''].dependencies.micromatch = '^4.0.8';
  expect(isAcceptedAdvisory({ packageName: 'braces', source: 1240992, lockfile: changed, now: reviewedAt })).toBe(false);
});


describe.each([1164823, 1241262, 1241263])('stream-json advisory %s constrained review', (source) => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  const accepted = (candidate = lockfile, clock = now) => isAcceptedAdvisory({ packageName: 'stream-json', source, lockfile: candidate, now: clock });

  it('accepts the exact reviewed native wallet path and expires without renewal', () => {
    expect(accepted()).toBe(true);
    expect(accepted(lockfile, Date.parse('2026-11-17T00:00:00Z'))).toBe(false);
    expect(accepted(lockfile, Date.parse('2026-10-23T23:59:59Z'))).toBe(false);
    expect(accepted(lockfile, NaN)).toBe(false);
  });

  it.each(['version', 'integrity'])('rejects changed package or parent %s', (field) => {
    for (const path of ['node_modules/stream-json', 'node_modules/jayson', 'node_modules/@clerk/expo']) {
      const changed = structuredClone(lockfile);
      changed.packages[path][field] += '-changed';
      expect(accepted(changed)).toBe(false);
    }
  });

  it('rejects changed ranges, kinds, new input paths, and nested copies', () => {
    const changedRange = structuredClone(lockfile);
    changedRange.packages[''].dependencies['@clerk/expo'] = '*';
    expect(accepted(changedRange)).toBe(false);
    const changedKind = structuredClone(lockfile);
    changedKind.packages['node_modules/jayson'].optionalDependencies = { 'stream-json': '^1.9.1' };
    delete changedKind.packages['node_modules/jayson'].dependencies['stream-json'];
    expect(accepted(changedKind)).toBe(false);
    const newPath = structuredClone(lockfile);
    newPath.packages[''].dependencies['stream-json'] = '^1.9.1';
    expect(accepted(newPath)).toBe(false);
    const duplicate = structuredClone(lockfile);
    duplicate.packages['node_modules/new-parent/node_modules/stream-json'] = structuredClone(duplicate.packages['node_modules/stream-json']);
    expect(accepted(duplicate)).toBe(false);
  });
});


describe('Zod wallet and CLI parent constraints', () => {
  const accepted = (candidate) => isAcceptedAdvisory({ packageName: 'zod', source: 1243066,
    lockfile: candidate, now: Date.parse('2026-10-24T12:00:00Z') });
  it.each(['expo', '@expo/cli', '@clerk/expo', '@clerk/clerk-js', '@base-org/account', '@coinbase/wallet-sdk',
    'ox', 'viem', 'abitype', 'viem/node_modules/abitype', 'viem/node_modules/ox'])(
    'rejects changed intermediate metadata for %s', (name) => {
      for (const field of ['version', 'integrity']) {
        const changed = structuredClone(lockfile);
        changed.packages[`node_modules/${name}`][field] += '-changed';
        expect(accepted(changed)).toBe(false);
      }
    });
  it.each(['expo', '@expo/cli', '@clerk/expo', '@clerk/clerk-js', '@base-org/account', '@coinbase/wallet-sdk', 'ox', 'viem', 'abitype'])(
    'rejects new declarations of intermediate %s', (name) => {
      const changed = structuredClone(lockfile);
      changed.packages['node_modules/new-runtime-parent'] = { dependencies: { [name]: '*' } };
      expect(accepted(changed)).toBe(false);
    });
});


const auditFixture = vi.hoisted(() => ({ result: null }));
vi.mock('node:child_process', () => ({ spawnSync: () => auditFixture.result }));

// Import the real CLI with only npm's process result replaced: no registry call.
async function runAudit(result) {
  auditFixture.result = result;
  vi.resetModules();
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => { throw Error(`audit-exit:${code}`); });
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await import('./audit-runtime.mjs');
    return { status: 0, output: log.mock.calls.flat().join(' ') };
  } catch (failure) {
    if (failure.message !== 'audit-exit:1') throw failure;
    return { status: 1, output: error.mock.calls.flat().join(' ') };
  } finally {
    exit.mockRestore(); log.mockRestore(); error.mockRestore();
  }
}
function report(vulnerabilities = {}, severity = 'high') {
  const total = Object.keys(vulnerabilities).length;
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: {
    info: 0, low: 0, moderate: 0, high: 0, critical: 0, [severity]: total, total,
  } } };
}
function result(body, status = Object.keys(body?.vulnerabilities ?? {}).length ? 1 : 0) {
  return { status, signal: null, stdout: JSON.stringify(body), stderr: '' };
}
const reviewedFinding = { severity: 'high', via: [{ source: 1119441, severity: 'high', title: 'Reviewed UUID advisory' }] };

describe('npm audit report validation', () => {
  it('accepts a complete clean report', async () => {
    expect(await runAudit(result(report()))).toMatchObject({ status: 0, output: expect.stringContaining('0 inherited') });
  });
  it('accepts exit one with reviewed findings and their transitive references', async () => {
    const body = report({ uuid: reviewedFinding, parent: { severity: 'high', via: ['uuid'] } });
    expect(await runAudit(result(body, 1))).toMatchObject({ status: 0, output: expect.stringContaining('2 inherited') });
  });
  it.each([
    { error: Error('spawn failed'), status: null, stdout: '' },
    { status: 2, stdout: JSON.stringify(report()) },
    { status: null, signal: 'SIGTERM', stdout: JSON.stringify(report()) },
    { status: 0, stdout: 'not json' },
    result({ error: { code: 'E401' } }, 1),
    result({}), result(null), result([]),
    result({ metadata: report().metadata }),
    result({ ...report(), vulnerabilities: [] }),
    result({ ...report(), vulnerabilities: null }),
    result({ ...report(), metadata: {} }),
    result({ ...report(), auditReportVersion: 1 }),
    result(report(), 1),
  ])('rejects failed or incomplete npm result %#', async (candidate) => {
    expect((await runAudit(candidate)).status).toBe(1);
  });
  it.each([undefined, -1, 0.5, '0', NaN, Infinity])('rejects invalid severity counts %s', async (value) => {
    const body = report(); body.metadata.vulnerabilities.critical = value;
    expect((await runAudit(result(body))).status).toBe(1);
  });
  it('rejects counts that hide or misclassify a finding', async () => {
    const body = report({ uuid: reviewedFinding });
    body.metadata.vulnerabilities.high = 0; body.metadata.vulnerabilities.total = 0;
    expect((await runAudit(result(body, 0))).status).toBe(1);
    body.metadata.vulnerabilities.low = 1; body.metadata.vulnerabilities.total = 1;
    expect((await runAudit(result(body, 1))).status).toBe(1);
  });
  it.each([
    null, [], {}, { severity: 'high', via: [] }, { severity: 'high', via: ['absent'] },
    { severity: 'high', via: [{}] }, { severity: 'unknown', via: ['uuid'] },
    { severity: 'high', via: [{ source: '1119441', severity: 'high', title: 'Invalid source' }] },
    { severity: 'high', via: [{ source: 1119441, severity: 'critical', title: 'Hidden critical' }] },
  ])('rejects malformed vulnerability entry %#', async (finding) => {
    expect((await runAudit(result(report({ uuid: finding })))).status).toBe(1);
  });
  it.each([
    { rogue: { severity: 'high', via: ['rogue'] } },
    { first: { severity: 'high', via: ['second'] }, second: { severity: 'high', via: ['first'] } },
  ])('rejects unanchored vulnerability cycles %#', async (findings) => {
    expect((await runAudit(result(report(findings), 1))).status).toBe(1);
  });
  it('accepts cycles anchored in a reviewed direct advisory', async () => {
    const findings = {
      first: { severity: 'high', via: ['uuid'] },
      uuid: { severity: 'high', via: ['first', ...reviewedFinding.via] },
    };
    expect(await runAudit(result(report(findings), 1))).toMatchObject({ status: 0, output: expect.stringContaining('2 inherited') });
  });
  it('retains denial of critical and unreviewed advisories', async () => {
    const critical = { severity: 'critical', via: [{ source: 1119441, severity: 'critical', title: 'Critical UUID' }] };
    expect((await runAudit(result(report({ uuid: critical }, 'critical')))).status).toBe(1);
    const unknown = { severity: 'high', via: [{ source: 999999999, severity: 'high', title: 'New advisory' }] };
    expect((await runAudit(result(report({ uuid: unknown })))).status).toBe(1);
  });
});

it('removes the obsolete node-forge acceptance after patching', () => {
  expect(isAcceptedAdvisory({ packageName: 'node-forge', source: 1240912, lockfile, now: reviewedAt })).toBe(false);
});

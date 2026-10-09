import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

const reviewedAt = Date.parse('2026-10-09T12:00:00Z');
const buildToolAdvisories = [
  { packageName: 'braces', source: 1240992, parent: 'node_modules/micromatch' },
  { packageName: 'node-forge', source: 1240912, parent: 'node_modules/@expo/cli' },
];

describe.each(buildToolAdvisories)('$packageName temporary build-tool review', (advisory) => {
  function accepted(changedLockfile = lockfile, now = reviewedAt, source = advisory.source) {
    return isAcceptedAdvisory({ ...advisory, source, lockfile: changedLockfile, now });
  }

  it('accepts only the reviewed tree before its existing expiry', () => {
    expect(accepted()).toBe(true);
    expect(accepted(lockfile, Date.parse('2026-11-02T23:59:59.999Z'))).toBe(true);
  });

  it('rejects expiry, dates before review, and invalid clocks', () => {
    for (const now of [Date.parse('2026-11-03T00:00:00Z'), Date.parse('2026-10-03T23:59:59Z'), NaN]) {
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
    rangeChanged.packages[advisory.parent].dependencies[advisory.packageName] = '*';
    expect(accepted(rangeChanged)).toBe(false);
    const kindChanged = structuredClone(lockfile);
    kindChanged.packages[advisory.parent].optionalDependencies = {
      [advisory.packageName]: kindChanged.packages[advisory.parent].dependencies[advisory.packageName],
    };
    delete kindChanged.packages[advisory.parent].dependencies[advisory.packageName];
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
  const now = Date.parse('2026-10-09T12:00:00Z');
  const accepted = (candidate = lockfile, clock = now) => isAcceptedAdvisory({ packageName: 'stream-json', source, lockfile: candidate, now: clock });

  it('accepts the exact reviewed native wallet path and expires without renewal', () => {
    expect(accepted()).toBe(true);
    expect(accepted(lockfile, Date.parse('2026-11-03T00:00:00Z'))).toBe(false);
    expect(accepted(lockfile, Date.parse('2026-10-08T23:59:59Z'))).toBe(false);
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

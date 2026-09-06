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

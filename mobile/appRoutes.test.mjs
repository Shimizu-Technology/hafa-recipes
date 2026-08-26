import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const routeRoot = fileURLToPath(new URL('./app', import.meta.url));

/** Return test modules that Expo Router would otherwise treat as application routes. */
function findTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findTestFiles(path);
    return /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe('Expo Router file boundaries', () => {
  it('keeps test modules outside the app route directory', () => {
    const testFiles = findTestFiles(routeRoot).map((path) => relative(routeRoot, path));

    expect(testFiles).toEqual([]);
  });
});

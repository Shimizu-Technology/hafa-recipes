import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const source = readFileSync(new URL('../app/(tabs)/_layout.tsx', import.meta.url), 'utf8');
describe('four-tab shell', () => {
  it('starts on Recipes and hides legacy route aliases', () => {
    expect(source).toContain('initialRouteName="recipes"');
    expect(source).toContain('name="discover" options={{ href: null }}');
    expect(source).toContain('name="history" options={{ href: null }}');
    expect(source).not.toContain('AssistantTabBar');
    expect(source).toContain("title: 'Add'");
  });
  it.each([['history', 'library'], ['discover', 'discover']])('preserves %s links', (route, scope) => {
    const alias = readFileSync(new URL(`../app/(tabs)/${route}.tsx`, import.meta.url), 'utf8');
    expect(alias).toContain("pathname: '/(tabs)/recipes'");
    expect(alias).toContain(`scope: '${scope}'`);
  });
});

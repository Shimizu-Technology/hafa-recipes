import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const source = readFileSync(new URL('../app/(tabs)/_layout.tsx', import.meta.url), 'utf8');
describe('native tab shell', () => {
  it('keeps all five content destinations and leaves capture on the root stack', () => {
    expect(source.match(/<NativeTabs.Trigger name=/g)).toHaveLength(5);
    expect(source).toContain('role="search"');
    expect(source).toContain('minimizeBehavior="onScrollDown"');
    expect(source).not.toContain('tabBarButton');
    expect(source).not.toContain('ImportTabIcon');
    expect(source).not.toContain('name="index"');
    expect(source).not.toContain('hidden');
  });
  it.each(['recipes', 'discover', 'planner', 'grocery', 'search'])('%s uses a native stack', route => {
    const layout = readFileSync(new URL(`../app/(tabs)/${route}/_layout.tsx`, import.meta.url), 'utf8');
    expect(layout).toContain('RecipeTabStack');
  });
  it('keeps legacy capture and history outside the tabs', () => {
    expect(readFileSync(new URL('../app/index.tsx', import.meta.url), 'utf8')).toContain('consumePendingShareCapture');
    expect(readFileSync(new URL('../app/history.tsx', import.meta.url), 'utf8')).toContain("pathname: '/(tabs)/recipes'");
  });
});

// Keep the workaround scoped to UIKit 26 while older platforms retain a solid header.
describe('tab header compatibility', () => {
  it.each([['ios', 26, true], ['ios', '26.5', true], ['ios', 18, false], ['android', 36, false]])('%s %s header transparency is %s', (os, version, expected) => {
    const code = readFileSync(new URL('../components/RecipeTabStack.tsx', import.meta.url), 'utf8');
    const expression = code.match(/const transparentHeader = (.*);/)[1];
    expect(new Function('Platform', `return ${expression}`)({ OS: os, Version: version })).toBe(expected);
  });
});

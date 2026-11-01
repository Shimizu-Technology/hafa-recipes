import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const source = readFileSync(new URL('../app/(tabs)/_layout.tsx', import.meta.url), 'utf8');
describe('tab shell', () => {
  it('draws its own bar with four destinations and leaves capture on the root stack', () => {
    expect(source).not.toContain('unstable-native-tabs');
    expect(source).toContain('tabBar={props => <HafaTabBar');
    expect(source.match(/<Tabs.Screen name=/g)).toHaveLength(4);
    expect(source).not.toContain('name="index"');
    expect(source).not.toContain('name="search"');
  });
  it.each(['recipes', 'discover', 'planner', 'grocery'])('%s uses a native stack', route => {
    const layout = readFileSync(new URL(`../app/(tabs)/${route}/_layout.tsx`, import.meta.url), 'utf8');
    expect(layout).toContain('RecipeTabStack');
  });
  it('keeps legacy capture and history outside the tabs', () => {
    expect(readFileSync(new URL('../app/index.tsx', import.meta.url), 'utf8')).toContain('consumePendingShareCapture');
    expect(readFileSync(new URL('../app/history.tsx', import.meta.url), 'utf8')).toContain("pathname: '/(tabs)/recipes'");
  });
});

describe('tab header', () => {
  const code = readFileSync(new URL('../components/RecipeTabStack.tsx', import.meta.url), 'utf8');
  it('stays a solid colour on every OS without making the iOS bar non-translucent', () => {
    expect(code).toContain('headerStyle: { backgroundColor: colors.background }');
    // headerTransparent: false hides large titles beside a header search bar on iOS.
    expect(code).not.toMatch(/headerTransparent:\s*false/);
  });
  it.each([['ios', '26.0', true], ['ios', 26, true], ['ios', '18.5', false], ['android', 36, false]])('%s %s clears the large-title background: %s', (os, version, clear) => {
    const expression = code.match(/export const liquidGlassHeader = (.*);/)[1];
    expect(new Function('Platform', `return ${expression}`)({ OS: os, Version: version })).toBe(clear);
    expect(code).toContain("headerLargeStyle: { backgroundColor: liquidGlassHeader ? 'transparent' : colors.background }");
  });
  it('keeps header search under the title instead of floating over the list on iOS 26', () => {
    expect(readFileSync(new URL('../app/(tabs)/grocery/index.tsx', import.meta.url), 'utf8')).toContain("headerSearchBarOptions: { placement: 'stacked'");
    expect(readFileSync(new URL('../app/search.tsx', import.meta.url), 'utf8')).toContain('placement="stacked"');
  });
});

// NativeTabs scrolled a re-tapped tab to the top; the Håfa tab bar relies on each root registering its list.
describe('tab re-tap scroll to top', () => {
  it.each([
    ['app/history.tsx', 'recipes', ['listRef']],
    ['app/(tabs)/discover/index.tsx', 'discover', ['listRef']],
    ['app/(tabs)/planner/index.tsx', 'planner', ['weekScroll']],
    ['app/(tabs)/grocery/index.tsx', 'grocery', ['listRef']],
  ])('%s registers its main list', (file, tab, refs) => {
    const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    expect(code).toMatch(new RegExp(`useTabScrollToTop\\('${tab}', `));
    for (const ref of refs) expect(code).toContain(`ref={${ref}}`);
  });
});

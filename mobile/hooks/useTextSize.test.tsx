import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { expect, it, vi } from 'vitest';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: storage.get, setItem: storage.set } }));
vi.mock('react-native', () => ({ Text: 'Text', StyleSheet: { flatten: (s: unknown) => Array.isArray(s) ? Object.assign({}, ...s) : s }, }));
vi.mock('@/components/useColorScheme', () => ({ useColorScheme: () => 'light' }));
vi.mock('@/components/Animated', () => ({ ScalePressable: 'Pressable' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Icon' }));
import { useTextSize } from './useTextSize';
import { Text, TextScaleContext } from '@/components/Themed';
let settings: ReturnType<typeof useTextSize>;
function SettingsBody() {
  settings = useTextSize();
  return <TextScaleContext.Provider value={settings.scale}><Text style={{ fontSize: 17, lineHeight: 22 }}>Settings body<Text>Nested</Text></Text></TextScaleContext.Provider>;
}
function RecipeBody() {
  const { scaleFontSize } = useTextSize();
  return <Text style={{ fontSize: scaleFontSize(24), lineHeight: scaleFontSize(32) }}>Recipe body</Text>;
}
it('reflows mounted Settings and other consumers immediately, keeping nested metrics and a newer selection over a slow storage read', async () => {
  let resolve!: (value: string) => void;
  storage.get.mockReturnValue(new Promise<string>(r => { resolve = r; }));
  const r = createRoot();
  await act(async () => r.render(<><SettingsBody /><RecipeBody /></>));
  const metrics = () => r.container.queryAll(n => n.type === 'Text').map(n => Object.assign({}, ...n.props.style));
  expect(metrics().map(s => s.fontSize)).toEqual([17, 17, 24]);
  await act(async () => settings.setTextSize('extra-large'));
  expect(metrics().map(s => [s.fontSize, s.lineHeight])).toEqual([[22,29], [22,29], [31,42]]);
  await act(async () => resolve('small'));
  expect(settings.textSize).toBe('extra-large'); expect(settings.isLoaded).toBe(true);
  expect(storage.get).toHaveBeenCalledTimes(1);
  expect(storage.set).toHaveBeenCalledWith('@text_size_preference', 'extra-large');
  await act(async () => settings.setTextSize('medium'));
  expect(metrics().map(s => s.fontSize)).toEqual([17,17,24]);
  await act(async () => r.unmount());
});

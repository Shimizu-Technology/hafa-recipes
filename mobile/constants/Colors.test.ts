import { describe, expect, it } from 'vitest';

import Colors from './Colors';

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Token = keyof typeof Colors.light;
// Opaque foreground/background pairs rendered by FilterBottomSheet and Tabs.
// Labels are small text, so the icon-only 3:1 threshold is insufficient.
const pairs: [label: string, fg: Token, bg: Token, minimum: number][] = [
  ['selected cook-time label and icon', 'onSuccess', 'success', 4.5],
  ['active tab label', 'tabLabelSelected', 'backgroundElevated', 4.5],
  ['active tab icon', 'tabIconSelected', 'backgroundElevated', 3],
  ['inactive tab label', 'tabIconDefault', 'backgroundElevated', 4.5],
];

describe.each(['light', 'dark'] as const)('%s control contrast', (scheme) => {
  it.each(pairs)('%s meets its contrast threshold', (_, fg, bg, minimum) => {
    expect(contrast(Colors[scheme][fg], Colors[scheme][bg])).toBeGreaterThanOrEqual(minimum);
  });

  it('keeps white primary-action text legible', () => {
    expect(contrast('#FFFFFF', Colors[scheme].tint)).toBeGreaterThanOrEqual(4.5);
  });
});

import { describe, expect, it } from 'vitest';

import Colors, { fontFamily, resolveFont, type ColorToken } from './Colors';

function opaque(color: string, background: string): string {
  if (!color.startsWith('rgba')) return color;
  const [r, g, b, a] = color.match(/[\d.]+/g)!.map(Number);
  const bg = background.slice(1).match(/../g)!.map(c => parseInt(c, 16));
  return '#' + [r, g, b].map((c, i) => Math.round(c * a + bg[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(opaque(a, b)), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

type Token = ColorToken;
// Opaque foreground/background pairs rendered by FilterBottomSheet and Tabs.
// Labels are small text, so the icon-only 3:1 threshold is insufficient.
const pairs: [label: string, fg: Token, bg: Token, minimum: number][] = [
  ['error-filled control foregrounds', 'onError', 'error', 4.5],
  ['selected cook-time label and icon', 'onSuccess', 'success', 4.5],
  ['active tab label', 'tabLabelSelected', 'backgroundElevated', 4.5],
  ['active tab icon', 'tabIconSelected', 'backgroundElevated', 3],
  ['inactive tab label', 'tabIconDefault', 'backgroundElevated', 4.5],
  // Calm pairs (gallery NOTES contrast table).
  ['body text on page', 'text', 'background', 4.5],
  ['secondary text on page', 'textSecondary', 'background', 4.5],
  ['secondary text on sheet', 'textSecondary', 'backgroundElevated', 4.5],
  ['accent text on page', 'actionText', 'background', 4.5],
  ['selected chip label on ink', 'onInk', 'ink', 4.5],
  ['no-photo glyph on its tile', 'placeholderInk', 'placeholder', 4.5],
  ['error text on page', 'error', 'background', 4.5],
  ['warning text on page', 'warning', 'background', 4.5],
  ['Ask sparkle on its white pill', 'actionText', 'backgroundElevated', 3],
];

describe.each(['light', 'dark'] as const)('%s control contrast', (scheme) => {
  it.each(pairs)('%s meets its contrast threshold', (_, fg, bg, minimum) => {
    expect(contrast(Colors[scheme][fg], Colors[scheme][bg])).toBeGreaterThanOrEqual(minimum);
  });

  it('keeps theme-specific primary-action text legible', () => {
    expect(contrast(Colors[scheme].onTint, Colors[scheme].tint)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Calm tokens', () => {
  it('uses a tinted page with white sheets, never pure black or iOS grey', () => {
    expect(Colors.light).toMatchObject({ background: '#F7F7F5', backgroundElevated: '#FFFFFF', card: '#FFFFFF', text: '#222222' });
    expect(Colors.dark).toMatchObject({ background: '#101211', backgroundElevated: '#1A1D1C', text: '#ECEEEC' });
    for (const scheme of [Colors.light, Colors.dark]) {
      expect(scheme.background).not.toBe('#000000');
      expect(scheme.backgroundSecondary).not.toBe('#F2F2F7');
    }
  });

  it('fills primary actions with deep reef and white text in both modes (no neon mint fills)', () => {
    expect(Colors.light.tint).toBe('#17695B');
    expect(Colors.dark.tint).toBe('#1B7466');
    expect(Colors.dark.onTint).toBe('#FFFFFF');
    expect(Colors.dark.accent).toBe('#8CCFBE');
  });

  it('marks the selected tab in ink, leaving the Import capsule as the bar\'s accent', () => {
    expect(Colors.light.tabIconSelected).toBe(Colors.light.text);
    expect(Colors.dark.tabIconSelected).toBe(Colors.dark.text);
  });
});

describe('resolveFont', () => {
  it.each([
    [undefined, undefined, fontFamily.regular],
    ['System', '600', fontFamily.semibold],
    [undefined, 'bold', fontFamily.bold],
    [undefined, '500', fontFamily.medium],
    [fontFamily.regular, '600', fontFamily.semibold],
    [fontFamily.display, '600', fontFamily.bold],
  ])('maps family %s at weight %s to one Figtree face', (family, weight, face) => {
    expect(resolveFont({ fontFamily: family, fontWeight: weight })).toEqual({ fontFamily: face, fontWeight: 'normal' });
  });

  it('keeps a named Figtree face without a weight, and passes other families through', () => {
    expect(resolveFont({ fontFamily: fontFamily.semibold })).toBeNull();
    expect(resolveFont({ fontFamily: 'Menlo', fontWeight: '600' })).toBeNull();
    expect(resolveFont({ fontFamily: fontFamily.recipeTitle, fontWeight: '600' })).toEqual({ fontFamily: 'Fraunces_500Medium', fontWeight: 'normal' });
  });
});

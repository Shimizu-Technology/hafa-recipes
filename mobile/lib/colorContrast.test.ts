import { describe, expect, it } from 'vitest';

import Colors from '../constants/Colors';

function relativeLuminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)?.map((channel) => parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error(`Expected a six-digit hex color, received ${hex}`);

  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('mobile color contrast', () => {
  for (const themeName of ['light', 'dark'] as const) {
    const theme = Colors[themeName];

    it(`${themeName} text tokens remain readable on primary surfaces`, () => {
      for (const foreground of [theme.text, theme.textSecondary, theme.textMuted]) {
        for (const background of [theme.background, theme.backgroundSecondary, theme.card]) {
          expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${themeName} semantic text colors remain readable on cards`, () => {
      for (const foreground of [theme.accent, theme.success, theme.warning, theme.error]) {
        expect(contrastRatio(foreground, theme.card)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${themeName} tab and primary-button colors preserve control contrast`, () => {
      expect(contrastRatio(theme.tabIconDefault, theme.backgroundElevated)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio('#FFFFFF', theme.tint)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

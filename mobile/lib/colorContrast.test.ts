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
  if (foreground.startsWith('rgba')) {
    const [r, g, b, a] = foreground.match(/[\d.]+/g)!.map(Number);
    foreground = composite('#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join(''), a, background);
  }
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Composite a translucent foreground (alpha 0-1) over an opaque background. */
function composite(foreground: string, alpha: number, background: string): string {
  const channels = (hex: string) => hex.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16));
  const top = channels(foreground);
  const bottom = channels(background);
  return `#${top.map((channel, index) => (
    Math.round((channel * alpha) + (bottom[index] * (1 - alpha))).toString(16).padStart(2, '0')
  )).join('')}`;
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

    it(`${themeName} action text stays readable on screens and cards`, () => {
      for (const background of [theme.background, theme.backgroundSecondary, theme.backgroundElevated, theme.card]) {
        expect(contrastRatio(theme.actionText, background)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${themeName} action text stays readable on translucent tint chips and notices`, () => {
      // Screens layer `tint + '15'` up to `tint + '40'` (8-25% alpha) behind action text.
      for (const alpha of [0x15 / 255, 0x20 / 255, 0x40 / 255]) {
        for (const surface of [theme.background, theme.backgroundSecondary, theme.card]) {
          const chip = composite(theme.tint, alpha, surface);
          expect(contrastRatio(theme.actionText, chip), `${chip} at ${alpha.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${themeName} tab and primary-button colors preserve control contrast`, () => {
      expect(contrastRatio(theme.tabIconDefault, theme.backgroundElevated)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(theme.onTint, theme.tint)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('keeps light-mode action text distinct from the fill to stay readable on tonal surfaces', () => {
    expect(Colors.light.tint).toBe('#1E7F6E');
    expect(contrastRatio(Colors.light.actionText, Colors.light.card)).toBeGreaterThanOrEqual(4.5);
  });
});

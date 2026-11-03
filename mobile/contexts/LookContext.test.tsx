import React, { act } from 'react';
import { createRoot } from 'test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: storage.get, setItem: storage.set } }));

import Colors from '@/constants/Colors';
import { BASE_DISPLAY_FONT, LOOK_IDS, LOOKS, lookTextFont, uiFontFor } from '@/constants/looks';
import { resolveAppEnvironment, showsDeveloperTools } from '@/lib/environmentConfig';
import { LOOK_STORAGE_KEY, LookProvider, lookFromLink, resolveLookId, useLook, useLookPreview } from './LookContext';

let preview: ReturnType<typeof useLookPreview>;
function Probe() {
  const look = useLook();
  preview = useLookPreview();
  return React.createElement('look', { id: look.id, ground: look.palette.light.background });
}
const probe = (r: ReturnType<typeof createRoot>) => r.container.queryAll(n => n.type === 'look')[0]?.props;

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('design preview gate', () => {
  it('is on in development and preview builds and off in production', () => {
    expect(showsDeveloperTools(resolveAppEnvironment('production', false))).toBe(false);
    expect(showsDeveloperTools(resolveAppEnvironment('preview', false))).toBe(true);
    expect(showsDeveloperTools(resolveAppEnvironment(undefined, true))).toBe(true);
  });

  it('resolves every stored or linked value to Current when the gate is off', () => {
    for (const id of LOOK_IDS) {
      expect(resolveLookId(id, false)).toBe('current');
      expect(lookFromLink(id, false)).toBeNull();
    }
  });

  it('accepts only known looks from storage and the deep link', () => {
    expect(resolveLookId('island', true)).toBe('island');
    expect(resolveLookId('neon', true)).toBe('current');
    expect(resolveLookId(null, true)).toBe('current');
    expect(lookFromLink('calm', true)).toBe('calm');
    expect(lookFromLink(['cookbook', 'calm'], true)).toBe('cookbook');
    expect(lookFromLink('current', true)).toBe('current');
    expect(lookFromLink('nope', true)).toBeNull();
    expect(lookFromLink(undefined, true)).toBeNull();
  });
});

describe('LookProvider', () => {
  beforeEach(() => { storage.get.mockReset(); storage.set.mockReset(); storage.set.mockResolvedValue(undefined); });

  it('never reads storage or loads fonts in production, and ignores switch attempts', async () => {
    storage.get.mockResolvedValue('island');
    const loadFonts = vi.fn(async () => {});
    const r = createRoot();
    await act(async () => r.render(<LookProvider enabled={false} loadFonts={loadFonts}><Probe /></LookProvider>));
    expect(probe(r)).toMatchObject({ id: 'current', ground: Colors.light.background });
    await act(async () => preview.setLook('calm'));
    expect(probe(r).id).toBe('current');
    expect(preview.enabled).toBe(false);
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
    expect(loadFonts).not.toHaveBeenCalled();
    await act(async () => r.unmount());
  });

  it('restores the saved look after its fonts load, holding the fallback until then', async () => {
    storage.get.mockResolvedValue('calm');
    let release!: () => void;
    const loadFonts = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const r = createRoot();
    await act(async () => r.render(<LookProvider enabled loadFonts={loadFonts} fallback={React.createElement('splash')}><Probe /></LookProvider>));
    expect(storage.get).toHaveBeenCalledWith(LOOK_STORAGE_KEY);
    expect(probe(r)).toBeUndefined();
    expect(r.container.queryAll(n => n.type === 'splash')).toHaveLength(1);
    await act(async () => release());
    expect(loadFonts).toHaveBeenCalledWith('calm');
    expect(probe(r)).toMatchObject({ id: 'calm', ground: LOOKS.calm.palette.light.background });
    await act(async () => r.unmount());
  });

  it('loads fonts before switching and persists the choice; Current resets it', async () => {
    storage.get.mockResolvedValue(null);
    const order: string[] = [];
    const loadFonts = vi.fn(async (id: string) => { order.push(`fonts:${id}`); });
    storage.set.mockImplementation(async (_key: string, value: string) => { order.push(`save:${value}`); });
    const r = createRoot();
    await act(async () => r.render(<LookProvider enabled loadFonts={loadFonts}><Probe /></LookProvider>));
    expect(probe(r).id).toBe('current');
    await act(async () => preview.setLook('island'));
    expect(probe(r).id).toBe('island');
    expect(storage.set).toHaveBeenLastCalledWith(LOOK_STORAGE_KEY, 'island');
    await act(async () => preview.setLook('current'));
    expect(probe(r).id).toBe('current');
    expect(order).toEqual(['fonts:current', 'fonts:island', 'save:island', 'fonts:current', 'save:current']);
    await act(async () => r.unmount());
  });

  it('falls back to Current when the saved look cannot load', async () => {
    storage.get.mockResolvedValue('cookbook');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = createRoot();
    await act(async () => r.render(<LookProvider enabled loadFonts={async () => { throw new Error('font'); }}><Probe /></LookProvider>));
    expect(probe(r).id).toBe('current');
    warn.mockRestore();
    await act(async () => r.unmount());
  });
});

describe('look tokens', () => {
  it('keeps Current identical to the shipped palette and fonts', () => {
    for (const scheme of ['light', 'dark'] as const) {
      for (const [key, value] of Object.entries(Colors[scheme])) {
        expect(LOOKS.current.palette[scheme][key as keyof typeof Colors.light]).toBe(value);
      }
    }
    expect(LOOKS.current.fonts).toBeNull();
    expect(lookTextFont(LOOKS.current.fonts, { fontWeight: '600' })).toBeNull();
    expect(LOOKS.current.variants).toMatchObject({ tabBar: 'current', askPill: 'accent', home: 'none', placeholder: 'current' });
  });

  it('gives every look a complete palette in both schemes, with no pure black ground', () => {
    for (const id of LOOK_IDS) {
      for (const scheme of ['light', 'dark'] as const) {
        const palette = LOOKS[id].palette[scheme];
        for (const key of Object.keys(Colors.light)) expect(palette).toHaveProperty(key);
        if (id !== 'current') expect(palette.background).not.toBe('#000000');
        expect(palette.dark).toBe(scheme === 'dark');
      }
    }
  });

  it.each(LOOK_IDS.filter(id => id !== 'current'))('%s meets text contrast in light and dark', id => {
    for (const scheme of ['light', 'dark'] as const) {
      const p = LOOKS[id].palette[scheme];
      const pairs: [string, string, string, number][] = [
        ['text/background', p.text, p.background, 4.5],
        ['text/elevated', p.text, p.backgroundElevated, 4.5],
        ['secondary/background', p.textSecondary, p.background, 4.5],
        ['secondary/elevated', p.textSecondary, p.backgroundElevated, 4.5],
        ['onTint/tint', p.onTint, p.tint, 4.5],
        ['actionText/background', p.actionText, p.background, 4.5],
        ['onInk/ink', p.onInk, p.ink, 4.5],
        ['onInkAccent/ink', p.onInkAccent, p.ink, 3],
        ['placeholderInk/placeholder', p.placeholderInk, p.placeholder, 4.5],
        ['error/background', p.error, p.background, 4.5],
        ['warning/background', p.warning, p.background, 4.5],
      ];
      for (const [name, fg, bg, min] of pairs) {
        expect({ name: `${scheme} ${name}`, ok: contrast(fg, bg) >= min }).toEqual({ name: `${scheme} ${name}`, ok: true });
      }
    }
  });

  it('maps system and display text onto one named face per weight', () => {
    const fonts = LOOKS.cookbook.fonts;
    expect(lookTextFont(fonts, {})).toEqual({ fontFamily: 'DMSans_400Regular', fontWeight: 'normal' });
    expect(lookTextFont(fonts, { fontFamily: 'System', fontWeight: '600' })).toEqual({ fontFamily: 'DMSans_600SemiBold', fontWeight: 'normal' });
    expect(lookTextFont(fonts, { fontWeight: 'bold' })?.fontFamily).toBe('DMSans_700Bold');
    expect(lookTextFont(LOOKS.calm.fonts, { fontFamily: BASE_DISPLAY_FONT })?.fontFamily).toBe('Figtree_700Bold');
    // An explicit look face (Calm's Fraunces detail title) passes through untouched.
    expect(lookTextFont(LOOKS.calm.fonts, { fontFamily: 'Fraunces_500Medium' })).toBeNull();
    expect(uiFontFor(LOOKS.island.fonts, '500')).toBe('PlusJakartaSans_500Medium');
  });

  it('follows the motion rules: press 0.96-0.98, at most 6 staggered rows, 30-50ms stagger', () => {
    for (const id of LOOK_IDS.filter(look => look !== 'current')) {
      const { press, entrance, indicator } = LOOKS[id].motion;
      expect(press.scale).toBeGreaterThanOrEqual(0.96);
      expect(press.scale).toBeLessThanOrEqual(0.98);
      expect(entrance.max).toBeLessThanOrEqual(6);
      expect(entrance.stagger).toBeGreaterThanOrEqual(30);
      expect(entrance.stagger).toBeLessThanOrEqual(50);
      expect(indicator.duration).toBe(300);
    }
  });
});

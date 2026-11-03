/**
 * Design-preview look selection. Production builds never read or write the choice and always render
 * `current`; development and preview builds remember it on the device.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { isLookId, LOOKS, type Look, type LookId } from '@/constants/looks';

export const LOOK_STORAGE_KEY = '@hafa/look-preview';

type LookContextValue = {
  look: Look;
  /** Whether this build offers the Design preview switcher and deep link. */
  enabled: boolean;
  setLook: (id: LookId) => Promise<void>;
};

const LookContext = createContext<LookContextValue>({ look: LOOKS.current, enabled: false, setLook: async () => {} });

/** The look a build should show for a stored or linked value. */
export function resolveLookId(value: unknown, enabled: boolean): LookId {
  return enabled && isLookId(value) ? value : 'current';
}

/** `look=<id>` from `hafarecipes://design-preview`; unknown values change nothing. */
export function lookFromLink(param: unknown, enabled: boolean): LookId | null {
  const value = Array.isArray(param) ? param[0] : param;
  return enabled && isLookId(value) ? value : null;
}

export function LookProvider({ children, enabled, loadFonts, fallback = null }: {
  children: ReactNode;
  enabled: boolean;
  /** Registers a look's fonts before it paints; injected so production never loads them. */
  loadFonts: (id: LookId) => Promise<void>;
  /** Shown while a remembered look's fonts load, so text never flashes in the wrong face. */
  fallback?: ReactNode;
}) {
  const [id, setId] = useState<LookId>('current');
  const [ready, setReady] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      try {
        const saved = resolveLookId(await AsyncStorage.getItem(LOOK_STORAGE_KEY), true);
        await loadFonts(saved);
        if (live) setId(saved);
      } catch (error) {
        console.warn('Design preview look unavailable; showing Current.', error);
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => { live = false; };
  }, [enabled, loadFonts]);

  const setLook = useCallback(async (next: LookId) => {
    if (!enabled) return;
    // Keep the previous look on screen until the new faces are registered.
    await loadFonts(next);
    setId(next);
    try {
      await AsyncStorage.setItem(LOOK_STORAGE_KEY, next);
    } catch (error) {
      console.warn('Failed to save design preview look:', error);
    }
  }, [enabled, loadFonts]);

  const value = useMemo(() => ({ look: LOOKS[enabled ? id : 'current'], enabled, setLook }), [enabled, id, setLook]);
  if (!ready) return <>{fallback}</>;
  return <LookContext.Provider value={value}>{children}</LookContext.Provider>;
}

/** The active look's tokens: palette, fonts, radii, density, shadows, variants and motion. */
export function useLook(): Look {
  return useContext(LookContext).look;
}

/** Switcher state for Settings › Design preview and the deep link. */
export function useLookPreview() {
  const { look, enabled, setLook } = useContext(LookContext);
  return { id: look.id, enabled, setLook };
}

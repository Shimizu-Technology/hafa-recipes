import { createContext, useContext, type ComponentType, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import type { BabyRecord, Child } from "./models";
import { LOOKS, type Look, type LookId, type Palette } from "./looks";

/**
 * Look-only components, supplied by the LookProvider (components/look-provider.tsx). Screens and primitives fall
 * back to main's rendering when a part is absent, so `current` and unit tests never load SVG, fonts or animations.
 */
export interface LookParts {
  TabBar?: ComponentType<any>;
  TodayMoment?: ComponentType<{ child: Child; today: Date; now: Date; tips: BabyRecord[] }>;
  Entrance?: ComponentType<{ index: number; born?: number; children: ReactNode }>;
  DetailHero?: ComponentType<{ record: BabyRecord; title: string }>;
  Placeholder?: ComponentType<{ record: BabyRecord; size: number; mark: React.ReactNode }>;
  DateBlock?: ComponentType<{ iso: string }>;
  Tape?: ComponentType<{ topic: string; index?: number }>;
  /** The look's signature confirmation when a tip is saved to a topic (scale, pin-drop). */
  SavedMoment?: ComponentType<{ children: ReactNode }>;
}
export interface LookState {
  look: Look;
  /** Choose a look (non-production only); resolves after its fonts load. */
  setLook: (id: LookId) => void;
  enabled: boolean;
  parts: LookParts;
}
export const LookContext = createContext<LookState>({ look: LOOKS.current, setLook: () => undefined, enabled: false, parts: {} });

export function useLook() {
  return useContext(LookContext);
}
/** The active look's palette for the system appearance. */
export function useLookColors(): Palette {
  const { look } = useLook();
  return useColorScheme() === "dark" ? look.palette.dark : look.palette.light;
}

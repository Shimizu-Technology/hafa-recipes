import { dark, light, radii, motion, type ColorTokens } from "@/constants/theme";

export const LOOK_STORAGE_KEY = "@hafa/look-preview";
export const lookIds = ["current", "athletic", "coach", "pro"] as const;
export type LookId = typeof lookIds[number];
export const previewEnabled = (environment?: string) => environment !== "production";
export function validLook(value: unknown): value is LookId { return lookIds.includes(value as LookId); }
export function restoredLook(value: unknown, enabled: boolean): LookId { return enabled && validLook(value) ? value : "current"; }
export function linkLook(value: unknown, enabled: boolean): LookId | null { return enabled && validLook(value) ? value : null; }
export const lookLabels: Record<LookId, { label: string; description: string }> = {
  current: { label: "Current", description: "The TestFlight design, unchanged." },
  athletic: { label: "1 · Athletic", description: "Condensed headlines, tonal covers and a bold training clock." },
  coach: { label: "2 · Coach", description: "Warm cream, friendly type and a little encouragement." },
  pro: { label: "3 · Pro", description: "Precise numbers, flat rows and quiet controls." },
};
function palette(id: LookId, night: boolean): ColorTokens {
  if (id === "current") return night ? dark : light;
  const athletic = id === "athletic", coach = id === "coach";
  const page = night ? coach ? "#1B1318" : athletic ? "#0B0B0C" : "#101113" : coach ? "#FFF7EC" : athletic ? "#FFF7EC" : "#FFFFFF";
  const surface = night ? coach ? "#261C22" : athletic ? "#161618" : "#191B1F" : "#FFFFFF";
  const raised = night ? coach ? "#34262E" : athletic ? "#222225" : "#24272C" : coach ? "#F5E6DA" : "#F0EFED";
  const text = night ? coach ? "#FBEFE8" : "#F5F5F2" : coach ? "#2B1B2E" : "#17120F";
  const muted = night ? coach ? "#C5AFBA" : "#B1B1B8" : coach ? "#6E5A62" : "#626166";
  const accent = night ? coach ? "#FF8A63" : "#FF7A50" : "#B63E18";
  const onAccent = night ? "#17120F" : "#FFFFFF";
  const soft = night ? coach ? "#3E2A30" : "#30241F" : coach ? "#FFE8D9" : "#F5E5DC";
  return {
    ...(night ? dark : light), background: page, groupedBackground: page, surface, elevated: surface, surface2: raised, sunken: raised,
    text, muted, secondaryLabel: muted, tertiaryLabel: muted, border: night ? "#454247" : "#D7D0C9", borderStrong: night ? "#A39BA0" : "#81767C",
    // Neutral structural actions leave coral to Start / Resume and PR markers.
    action: text, onAction: page, actionSoft: raised, onActionSoft: text,
    accent, accentText: accent, onAccent, accentSoft: soft, accentTint: soft,
    hero: surface, onHero: text, heroMuted: muted, heroAccent: accent, onHeroSoft: raised,
    tint: raised, tabBar: night ? surface : page, tabBarBorder: night ? "#39363B" : "#DED7CF", segment: surface,
    success: night ? "#83D7A3" : "#22673B", dataSuccess: night ? "#83D7A3" : "#22673B",
    warning: night ? "#EDC784" : "#735019", error: night ? "#FFB2A7" : "#A52222", errorSoft: night ? "#3C2024" : "#FCE9E6", destructive: night ? "#FFB2A7" : "#A52222", focus: accent,
    skeleton: raised,
  };
}
export function getLook(id: LookId) {
  const current = id === "current", coach = id === "coach", athletic = id === "athletic";
  return {
    id, palette: { light: palette(id, false), dark: palette(id, true) },
    fonts: current ? { regular: undefined, semibold: undefined, bold: undefined, display: undefined } : coach
      ? { regular: "Nunito_600SemiBold", semibold: "Nunito_700Bold", bold: "Nunito_800ExtraBold", display: "BricolageGrotesque_700Bold" }
      : { regular: "Inter_400Regular", semibold: "Inter_600SemiBold", bold: "Inter_700Bold", display: athletic ? "BarlowCondensed_700Bold" : "Inter_600SemiBold" },
    radii: current ? radii : { sm: coach ? 12 : 8, md: coach ? 24 : 12, lg: coach ? 24 : athletic ? 20 : 12, xl: coach ? 28 : 20, full: 999 },
    density: id === "pro" ? 0.9 : coach ? 1.1 : 1,
    shadows: coach ? { shadowColor: "#2B1B2E", shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 2 } : {},
    variants: { tabBar: id, header: id, headerButtons: id, buttons: id, chips: id, segmented: id, search: id, cards: id, grid: id, placeholder: id, mosaic: id, hero: id, ask: id, toast: id, today: id },
    motion: current ? { ...motion, stagger: 0, entrance: 0, signature: "none" } : { ...motion, fast: 100, pressOut: athletic || coach ? 140 : 160, pressScale: athletic || coach ? 0.96 : 0.97, stagger: 40, entrance: id === "pro" ? 150 : 240, signature: athletic ? "set-pop" : coach ? "week-dots" : "pr-drop" },
  };
}
export type Look = ReturnType<typeof getLook>;

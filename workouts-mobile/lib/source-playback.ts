/** Recipes' official-player policy, using Workouts' identity and manual playback. */
export interface SourcePlayer {
  provider: "YouTube" | "TikTok";
  embedUrl: string;
  aspectRatio: number;
  requestHeaders?: Record<string, string>;
}
export function sourceURL(value: string | null | undefined) {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}
export function embeddedSourcesEnabled(value = process.env.EXPO_PUBLIC_SOURCE_PLAYBACK_MODE) {
  const policy = value?.trim().toLowerCase();
  return !policy || policy === "embedded";
}
export function sourcePlayer(value: string): SourcePlayer | null {
  const url = sourceURL(value);
  if (!url || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
    const id = host === "youtu.be" && parts.length === 1 ? parts[0]
      : url.pathname === "/watch" ? url.searchParams.get("v")
      : parts.length === 2 && ["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : null;
    if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;
    const referrer = "https://com.shimizutechnology.hafaworkouts";
    return { provider: "YouTube", aspectRatio: 16 / 9,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=0&playsinline=1&rel=0&origin=${encodeURIComponent(referrer)}`,
      requestHeaders: { Referer: referrer } };
  }
  if (["tiktok.com", "www.tiktok.com", "m.tiktok.com"].includes(host) &&
    parts.length === 3 && parts[0].startsWith("@") && ["video", "photo"].includes(parts[1]) && /^\d{6,30}$/.test(parts[2])) {
    return { provider: "TikTok", aspectRatio: 9 / 16,
      embedUrl: `https://www.tiktok.com/player/v1/${parts[2]}?autoplay=0&description=1&music_info=1&rel=0` };
  }
  return null; // Instagram, short redirects and websites open only outside the app.
}
export function playerNavigationAllowed(player: SourcePlayer, destination: string) {
  if (destination === "about:blank") return true;
  const exact = (url: URL) => {
    const expected = new URL(player.embedUrl);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      url.hostname === expected.hostname && url.pathname === expected.pathname;
  };
  try {
    const url = new URL(destination);
    if (exact(url)) return true;
    return player.provider === "YouTube" && url.origin === "https://consent.youtube.com" && url.pathname === "/m" &&
      !!url.searchParams.get("continue") && exact(new URL(url.searchParams.get("continue")!));
  } catch { return false; }
}
export function containedPlayerSize(width: number, height: number, ratio: number) {
  const fitted = Math.max(0, Math.min(width, height * ratio));
  return { width: fitted, height: fitted / ratio };
}

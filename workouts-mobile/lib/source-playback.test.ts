import { describe, expect, it } from "vitest";
import { containedPlayerSize, embeddedSourcesEnabled, playerNavigationAllowed, sourcePlayer, sourceURL } from "./source-playback";

describe("official source players", () => {
  it.each([
    "https://youtu.be/abcDEF_1234?autoplay=1", "https://www.youtube.com/watch?v=abcDEF_1234",
    "https://m.youtube.com/shorts/abcDEF_1234", "https://youtube.com/live/abcDEF_1234",
  ])("builds only the identified YouTube player from %s", url => {
    const player = sourcePlayer(url)!;
    expect(player.provider).toBe("YouTube");
    expect(player.embedUrl).toContain("https://www.youtube-nocookie.com/embed/abcDEF_1234?");
    expect(new URL(player.embedUrl).searchParams.get("autoplay")).toBe("0");
    expect(player.requestHeaders?.Referer).toBe("https://com.shimizutechnology.hafaworkouts");
  });
  it.each(["video", "photo"])("uses TikTok's official %s player without autoplay", kind => {
    const player = sourcePlayer(`https://www.tiktok.com/@coach/${kind}/7412345678901234567`)!;
    expect(player.provider).toBe("TikTok");
    expect(player.embedUrl).toContain("https://www.tiktok.com/player/v1/7412345678901234567?autoplay=0");
  });
  it.each([
    "javascript:alert(1)", "file:///workout", "https://youtube.com.evil.test/watch?v=abcDEF_1234",
    "https://www.youtube.com:8443/watch?v=abcDEF_1234", "https://user:password@youtube.com/watch?v=abcDEF_1234",
    "https://youtube.com/watch?v=<script>", "https://tiktok.com.evil.test/@coach/video/7412345678901234567",
    "https://vm.tiktok.com/short", "https://instagram.com/reel/Example_42/", "https://example.test/workout",
  ])("never embeds unsupported or untrusted source %s", url => { expect(sourcePlayer(url)).toBeNull(); });
  it("keeps valid external sources while rejecting unsafe schemes and credential URLs", () => {
    expect(sourceURL("https://example.test:8443/workout")?.hostname).toBe("example.test");
    expect(sourceURL("javascript:alert(1)")).toBeNull();
    expect(sourceURL("https://user:secret@example.test/workout")).toBeNull();
  });
  it("supports the Recipes release rollback and fails closed for unknown policy values", () => {
    expect(embeddedSourcesEnabled("")).toBe(true); expect(embeddedSourcesEnabled(" EMBEDDED ")).toBe(true);
    expect(embeddedSourcesEnabled("external")).toBe(false); expect(embeddedSourcesEnabled("enabled")).toBe(false);
  });
  it("confines navigation to this player document and a scoped YouTube consent redirect", () => {
    const player = sourcePlayer("https://youtu.be/abcDEF_1234")!;
    expect(playerNavigationAllowed(player, player.embedUrl + "&lang=en")).toBe(true);
    expect(playerNavigationAllowed(player, "about:blank")).toBe(true);
    expect(playerNavigationAllowed(player, `https://consent.youtube.com/m?continue=${encodeURIComponent(player.embedUrl)}`)).toBe(true);
    for (const url of ["https://www.youtube.com/watch?v=abcDEF_1234", "https://www.youtube-nocookie.com/embed/another_123",
      "https://consent.youtube.com/m?continue=https://example.test", "https://user:secret@www.youtube-nocookie.com/embed/abcDEF_1234",
      "https://www.youtube-nocookie.com:8443/embed/abcDEF_1234", "http://www.youtube-nocookie.com/embed/abcDEF_1234",
      "https://example.test", "intent://youtube", "javascript:alert(1)"])
      expect(playerNavigationAllowed(player, url)).toBe(false);
  });
  it("contains landscape and portrait players inside the available rectangle", () => {
    expect(containedPlayerSize(360, 500, 16 / 9)).toEqual({ width: 360, height: 202.5 });
    expect(containedPlayerSize(800, 400, 9 / 16)).toEqual({ width: 225, height: 400 });
  });
});

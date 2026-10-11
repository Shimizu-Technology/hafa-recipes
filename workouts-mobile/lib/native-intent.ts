const MAX_INCOMING_LENGTH = 8192;
const fixedRoutes = new Set([
  "/",
  "/sign-in",
  "/onboarding",
  "/profile",
  "/settings",
  "/hafa-apps",
  "/training",
  "/capture",
  "/coach",
  "/build-plan",
  "/review-plan",
  "/connections",
  "/recipes-connection",
  "/account-data",
  "/activity-log",
  "/activity",
  "/ai-preferences",
  "/privacy",
  "/health-rationale",
  "/collections",
  "/measurements",
  "/measurement",
  "/reminders",
  "/share",
  "/sharing-links",
  "/(tabs)",
  "/(tabs)/library",
  "/(tabs)/plan",
  "/(tabs)/progress",
  "/library",
  "/plan",
  "/progress",
]);
export function safeIncomingEncoding(value: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_INCOMING_LENGTH ||
    /[\u0000-\u001f\u007f\\]/.test(value)
  )
    return false;
  // A bounded, single validation pass; never recursively decode the result.
  try {
    decodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}
export interface NativeIntentOptions {
  websiteOrigin?: string;
  development?: boolean;
}
export function incomingNativePath(path: string, options: NativeIntentOptions = {}): string {
  const fallback = "/invalid-link";
  if (!safeIncomingEncoding(path)) return fallback;
  try {
    let route: string, search: string;
    if (path.startsWith("/") && !path.startsWith("//")) {
      const url = new URL(path, "https://local.invalid");
      route = url.pathname;
      search = url.search;
    } else {
      const url = new URL(path);
      if (url.username || url.password || url.port) return fallback;
      if (url.protocol === "hafaworkouts:") {
        if (url.host === "oauth-callback") return "/sign-in"; // Auth-session subscribers receive the untouched original URL.
        if (
          url.host === "dataUrl=hafaworkoutsShareKey" &&
          ["#media", "#file", "#weburl", "#text"].includes(url.hash) &&
          !url.pathname &&
          !url.search
        )
          return "/capture";
        route = url.host ? `/${url.host}${url.pathname}` : url.pathname || "/";
        search = url.search;
      } else if (
        url.protocol === "https:" &&
        options.websiteOrigin &&
        url.origin === new URL(options.websiteOrigin).origin
      ) {
        route = url.pathname;
        search = url.search;
        if ((route === "/shared" || route === "/shared/") && /^[A-Za-z0-9_-]{43}$/.test(url.hash.slice(1)) && !search)
          route = `/shared/${url.hash.slice(1)}`;
      } else if (options.development && url.protocol === "exp+hafa-workouts:" && url.host === "expo-development-client")
        return "/";
      else return fallback;
    }
    // Observed app paths use literal ASCII route names, UUIDs and share tokens.
    // Reject encoded path separators/double-encoded route aliases before Router sees them.
    if (route.includes("%") || /[\u0000-\u0020\u007f]/.test(route)) return fallback;
    route = route.length > 1 ? route.replace(/\/$/, "") : route;
    if (
      !fixedRoutes.has(route) &&
      !/^\/(workout|edit-workout|organize|session|import|coach-action)\/[A-Za-z0-9_-]{1,100}$/.test(route) &&
      !/^\/shared\/[A-Za-z0-9_-]{43}$/.test(route)
    )
      return fallback;
    return route + search;
  } catch {
    return fallback;
  }
}

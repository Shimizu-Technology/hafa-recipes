/** Explicit origins only: inspect the spelling before URL canonicalizes aliases. */
function parseOrigin(raw: string) {
  const match = /^(https?):\/\/([^/\s?#\\]+)\/?$/i.exec(raw);
  if (!match || match[2].includes("@")) throw new Error("Invalid API origin");
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Invalid API origin");
  return { url, authority: match[2].toLowerCase() };
}

export function productionApiOrigin(raw: string) {
  const { url } = parseOrigin(raw);
  if (url.protocol !== "https:") throw new Error("HTTPS API origin required");
  return url.origin;
}

export function developmentApiOrigin(raw: string) {
  const { url, authority } = parseOrigin(raw);
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/.test(authority)) return url.origin;
  throw new Error("Loopback HTTP API origin required");
}

/** Vite dev only. HMR uses this explicitly selected loopback socket, not Host. */
export function developmentCSP(rawApi: string, port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid dev port");
  const api = rawApi ? developmentApiOrigin(rawApi) : "";
  return `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'self' ws://127.0.0.1:${port}${api ? ` ${api}` : ""}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'`;
}

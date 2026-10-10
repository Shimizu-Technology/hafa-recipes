import { expect, it, vi } from "vitest";
import { developmentApiOrigin, developmentCSP, productionApiOrigin } from "./api-origin";
import { publicApiBase } from "./public-share";

it.each(["localhost", "127.0.0.1", "[::1]"])("permits exactly the dev HTTP loopback %s", (host) => {
  expect(developmentApiOrigin(`http://${host}:8088`)).toBe(`http://${host}:8088`);
  expect(() => productionApiOrigin(`http://${host}:8088`)).toThrow();
});
it.each([
  "http://127.1:8088", "http://2130706433:8088", "http://0x7f000001:8088",
  "http://127.000.000.001:8088", "http://[0:0:0:0:0:0:0:1]:8088",
  "http://localhost.evil.test:8088", "http://localhost.:8088", "http://evil-localhost:8088",
  "http://192.168.1.1:8088", "http://0.0.0.0:8088", "http://dev.example:8088",
  "http://user:password@localhost:8088", "http://localhost:8088/api", "http://localhost:8088/?",
  "http://localhost:8088/#", "http://localhost:8088/?q=1", "http://localhost:8088/#x",
  " http://localhost:8088", "http://local%68ost:8088", "http://localhost:65536",
])("rejects malformed/non-loopback origin %s in development and production", (raw) => {
  expect(() => developmentApiOrigin(raw)).toThrow();
  expect(() => productionApiOrigin(raw)).toThrow();
});
it("preserves ordinary HTTPS origins in both modes", () => {
  expect(productionApiOrigin("https://api.example.test/")).toBe("https://api.example.test");
  expect(productionApiOrigin("https://münich.example")).toBe("https://xn--mnich-kva.example");
  expect(productionApiOrigin("https://[::ffff:127.0.0.1]:8443")).toBe("https://[::ffff:7f00:1]:8443");
  expect(developmentApiOrigin("https://api.example.test:8443")).toBe("https://api.example.test:8443");
  for (const raw of ["https://u:p@api.example.test", "https://api.example.test/path", "https://api.example.test/?", "https://api.example.test/#"])
    expect(() => productionApiOrigin(raw)).toThrow();
});
it("production caller rejects HTTP even when passed an obsolete runtime opt-in argument", () => {
  vi.stubEnv("DEV", false);
  try {
    expect(() => Reflect.apply(publicApiBase, null, ["http://127.0.0.1:8088", true])).toThrow();
    expect(publicApiBase("https://api.example.test")).toBe("https://api.example.test");
  } finally { vi.unstubAllEnvs(); }
});
it("dev CSP permits only selected exact API and HMR origins", () => {
  const csp = developmentCSP("http://127.0.0.1:8088", 5182);
  expect(csp).toContain("connect-src 'self' ws://127.0.0.1:5182 http://127.0.0.1:8088;");
  expect(csp).not.toMatch(/\*|connect-src[^;]*(?:https?:|wss?:)\/\/[^ ;]+(?::\*)/);
  expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  expect(csp).toContain("object-src 'none'");
  expect(() => developmentCSP("http://dev.example:8088", 5182)).toThrow();
  expect(() => developmentCSP("", 0)).toThrow();
});

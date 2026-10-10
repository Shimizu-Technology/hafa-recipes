import { expect, it, vi } from "vitest";
import type { Plugin, ViteDevServer } from "vite";
import config from "../vite.config";

it("reserves loopback opt-in to Vite serve, even with a development build mode", async () => {
  if (typeof config !== "function") throw new Error("Expected config factory");
  const served = await config({ command: "serve", mode: "development" });
  const built = await config({ command: "build", mode: "development" });
  expect(served.define?.__WORKOUTS_DEV_LOOPBACK__).toBe(true);
  expect(built.define?.__WORKOUTS_DEV_LOOPBACK__).toBe(false);
  expect(built.server?.headers).toBeUndefined();
  expect((built.plugins?.[1] as Plugin).apply).toBe("serve");
});

it("dev middleware uses actual selected socket port and exact configured API", async () => {
  vi.stubEnv("VITE_WORKOUTS_PUBLIC_API_BASE", "http://127.0.0.1:8088");
  try {
    if (typeof config !== "function") throw new Error("Expected config factory");
    const selected = await config({ command: "serve", mode: "development" });
    const plugin = selected.plugins?.[1] as Plugin;
    const middleware = vi.fn();
    const hook = plugin.configureServer;
    if (typeof hook !== "function") throw new Error("Missing dev server hook");
    Reflect.apply(hook, {}, [{
      httpServer: { address: () => ({ port: 5182 }) },
      config: { server: { port: 5173 } },
      middlewares: { use: middleware },
    } as unknown as ViteDevServer]);
    const response = { setHeader: vi.fn() };
    const next = vi.fn();
    middleware.mock.calls[0][0]({}, response, next);
    expect(response.setHeader).toHaveBeenCalledWith("Content-Security-Policy", expect.stringContaining("connect-src 'self' ws://127.0.0.1:5182 http://127.0.0.1:8088;"));
    expect(response.setHeader).toHaveBeenCalledWith("Referrer-Policy", "no-referrer");
    expect(next).toHaveBeenCalledOnce();
  } finally { vi.unstubAllEnvs(); }
});

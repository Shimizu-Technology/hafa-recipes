import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { developmentCSP } from "./src/api-origin.ts";
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), {
      name: "workouts-local-preview-policy",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use((_request, response, next) => {
          const address = server.httpServer?.address();
          const port = address && typeof address !== "string" ? address.port : server.config.server.port;
          response.setHeader("Content-Security-Policy", developmentCSP(env.VITE_WORKOUTS_PUBLIC_API_BASE ?? "", port ?? 5173));
          response.setHeader("Referrer-Policy", "no-referrer");
          next();
        });
      },
    }],
    // command is a build-time decision; a VITE flag/query/runtime boolean cannot
    // enable loopback HTTP in a built release, even with NODE_ENV=development.
    define: { __WORKOUTS_DEV_LOOPBACK__: command === "serve" },
    server: { host: "127.0.0.1", hmr: { host: "127.0.0.1" } },
    build: { sourcemap: false },
  };
});

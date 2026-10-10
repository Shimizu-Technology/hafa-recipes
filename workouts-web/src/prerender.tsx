import { renderToString } from "react-dom/server";
import { App } from "./App";
export const render = (path: string) => renderToString(<App path={path} />);

export { publicApiBase } from "./public-share";
// Vite embeds the same selected dotenv/process value in both bundles. The
// post-build script must not select a second, potentially different origin.
export const configuredPublicApiBase = import.meta.env.VITE_WORKOUTS_PUBLIC_API_BASE ?? "";

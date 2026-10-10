import { hydrateRoot, createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
const root = document.getElementById("root")!;
const app = <App path={location.pathname.replace(/\/$/, "") || "/"} />;
const expectedRoute = location.pathname.startsWith("/shared/")
  ? "/shared"
  : location.pathname.replace(/\/$/, "") || "/";
if (root.hasChildNodes() && root.dataset.route === expectedRoute) hydrateRoot(root, app);
else createRoot(root).render(app);

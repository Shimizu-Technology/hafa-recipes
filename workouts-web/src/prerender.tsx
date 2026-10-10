import { renderToString } from "react-dom/server";
import { App } from "./App";
export const render = (path: string) => renderToString(<App path={path} />);

export { publicApiBase } from "./public-share";

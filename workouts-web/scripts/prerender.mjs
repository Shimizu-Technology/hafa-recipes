import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { render, publicApiBase } from "../.ssr/prerender.js";
const template = await readFile("dist/index.html", "utf8");
for (const [path, title] of [
  ["/", "Håfa Workouts · Train your way"],
  ["/support", "Support · Håfa Workouts"],
  ["/privacy", "Privacy · Håfa Workouts"],
  ["/delete-account", "Account & data deletion · Håfa Workouts"],
  ["/terms", "Terms · Håfa Workouts"],
  ["/shared", "A reviewed public snapshot · Håfa Workouts"],
]) {
  const dir = path === "/" ? "dist" : `dist${path}`;
  await mkdir(dir, { recursive: true });
  const content = template
    .replace('<div id="root"></div>', `<div id="root" data-route="${path}">${render(path)}</div>`)
    .replace(/<title>.*?<\/title>/, `<title>${title.replaceAll("&", "&amp;")}</title>`)
    .replace(
      "</head>",
      path === "/shared" ? '<meta name="robots" content="noindex,nofollow,noarchive"/></head>' : "</head>"
    );
  await writeFile(`${dir}/index.html`, content);
}

const api = process.env.VITE_WORKOUTS_PUBLIC_API_BASE ? publicApiBase(process.env.VITE_WORKOUTS_PUBLIC_API_BASE) : "";
await writeFile(
  "dist/_headers",
  `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self' ${api}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'
/shared
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow, noarchive
/shared/*
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow, noarchive
`
);

await rm(".ssr", { recursive: true, force: true });

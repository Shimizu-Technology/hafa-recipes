import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const root = new URL("../dist", import.meta.url).pathname;
function walk(path) { return readdirSync(path, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? walk(join(path,entry.name)) : [join(path,entry.name)]); }
const maps = walk(root).filter(path => path.endsWith(".hbc.map"));
if (maps.length !== 2) throw new Error("Expected both iOS and Android Hermes source maps");
for (const path of maps) {
  const sources = JSON.parse(readFileSync(path,"utf8")).sources ?? [];
  if (!sources.some(source => source.endsWith("/@clerk/clerk-js/dist/clerk.native.js"))) throw new Error("Native Clerk selection changed; review dependency reachability");
  if (!sources.some(source => source.endsWith("/expo-router/build/fork/getStateFromPath.js"))) throw new Error("Router implementation changed; review incoming-link decoding");
  const unsafe = sources.filter(source => /\/node_modules\/(?:stream-json|jayson|node-forge|braces)\//.test(source));
  if (unsafe.length) throw new Error(`Unreviewed native dependency reachability: ${unsafe.join(",")}`);
}
console.log("Both native bundles select Clerk native and Expo Router fork; reviewed build/socket dependencies are absent. Incoming-link runtime checks remain separate.");

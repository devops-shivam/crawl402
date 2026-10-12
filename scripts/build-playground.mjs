// Builds playground/dist: the static page plus the compiled library under lib/.
// Run `npm run playground` (it builds the library first), then open playground/dist/index.html
// through any static server, e.g. `npx serve playground/dist`.
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "playground", "dist");

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "lib"), { recursive: true });
await cp(join(root, "dist"), join(out, "lib"), {
  recursive: true,
  filter: (src) => !/\.(d\.ts|map)$/.test(src) && !src.endsWith(".d.ts.map"),
});
for (const file of ["index.html", "app.js"]) await cp(join(root, "playground", file), join(out, file));

const count = async (dir) => (await readdir(dir, { recursive: true })).filter((f) => f.endsWith(".js")).length;
console.log(`playground/dist ready (${await count(join(out, "lib"))} library modules)`);

// Prints the CHANGELOG.md section for a version (default: the version in package.json).
// Exits with an error if there is no "## <version>" heading, so CI can insist on release notes.
//
//   node scripts/release-notes.mjs          # notes for package.json version
//   node scripts/release-notes.mjs 0.2.0    # notes for a given version
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const version = process.argv[2] ?? pkg.version;
const changelog = await readFile(new URL("CHANGELOG.md", root), "utf8");

const lines = changelog.split("\n");
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const start = lines.findIndex((line) => new RegExp(`^## \\[?v?${escaped}\\]?(\\s|$)`).test(line));
if (start === -1) {
  console.error(`CHANGELOG.md has no "## ${version}" section. Add release notes for ${version} before releasing.`);
  process.exit(1);
}
let end = lines.findIndex((line, i) => i > start && /^## /.test(line));
if (end === -1) end = lines.length;
const notes = lines.slice(start + 1, end).join("\n").trim();
if (!notes) {
  console.error(`The "## ${version}" section in CHANGELOG.md is empty.`);
  process.exit(1);
}
console.log(notes);

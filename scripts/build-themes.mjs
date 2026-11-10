// Writes themes.json from themes/<id>.json (scripts/lib/themes.mjs). Run by the "Update themes"
// workflow when main changes; `--check` only checks and writes nothing (pull requests).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildThemesIndex, loadThemes } from "./lib/themes.mjs";

const OFFICIAL = "TixXin";
const root = fileURLToPath(new URL("..", import.meta.url));
const { themes, errors } = loadThemes(root);
for (const error of errors) console.error(error);
if (errors.length > 0) process.exit(1);
if (process.argv.includes("--check")) {
  console.log(`${themes.length} themes are fine.`);
} else {
  writeFileSync(`${root}themes.json`, `${JSON.stringify(buildThemesIndex(themes, OFFICIAL, new Date().toISOString()), null, 2)}\n`);
  console.log(`Wrote themes.json with ${themes.length} themes.`);
}

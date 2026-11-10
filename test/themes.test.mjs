import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildThemesIndex, loadThemes, themeErrors } from "../scripts/lib/themes.mjs";

const good = {
  id: "someone.dusk",
  name: { "zh-CN": "黄昏", en: "Dusk" },
  author: "someone",
  appearance: { islandBackgroundColor: "#1b1020", pulseColor: "#ff9a5a", islandCornerRadius: 24 },
};

test("a theme sets the look only, with values the island allows", () => {
  assert.deepEqual(themeErrors(good, "someone.dusk.json"), []);
  assert.match(themeErrors({ ...good, appearance: { collapsedScale: 1.2 } }).join(), /not a theme field/);
  assert.match(themeErrors({ ...good, appearance: { pulseColor: "red" } }).join(), /colour/);
  assert.match(themeErrors({ ...good, appearance: { opacity: 20 } }).join(), /from 50 to 100/);
  assert.match(themeErrors({ ...good, appearance: { appearanceMode: "neon" } }).join(), /one of/);
  assert.match(themeErrors(good, "other.json").join(), /named someone.dusk.json/);
  assert.match(themeErrors({ ...good, name: { en: "Dusk" } }).join(), /zh-CN/);
});

test("the repository's own themes check out, official ones first in the index", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const { themes, errors } = loadThemes(root);
  assert.deepEqual(errors, []);
  assert.ok(themes.length >= 1);
  const index = buildThemesIndex([...themes, good], "TixXin", "2026-11-10T00:00:00.000Z");
  assert.equal(index.version, 1);
  assert.equal(index.themes[index.themes.length - 1].id, "someone.dusk");
});

test("the todo paper colour is no longer a theme field (fly-island C28)", () => {
  assert.match(themeErrors({ ...good, appearance: { todoBackgroundColor: "#ffffff" } }).join(), /not a theme field/);
});

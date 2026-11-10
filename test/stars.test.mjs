import assert from "node:assert/strict";
import test from "node:test";
import { buildStars, discussionFor, listedPlugins, pluginOf, sameStars, thumbsUp } from "../scripts/update-stars.mjs";

const clock = { id: "com.example.clock", name: { "zh-CN": "时钟", en: "Clock" }, repo: "example/clock" };
const timer = { id: "com.example.timer", name: { "zh-CN": "计时", en: "Timer" } };
const likes = (count) => [{ content: "HEART", reactors: { totalCount: 9 } }, { content: "THUMBS_UP", reactors: { totalCount: count } }];

test("the market's plugins: stable entries, one per id", () => {
  const plugins = listedPlugins({ plugins: [clock, { ...clock, preRelease: true }, { ...clock }, timer] });
  assert.deepEqual(plugins.map((plugin) => plugin.id), ["com.example.clock", "com.example.timer"]);
});

test("a new discussion carries the marker the count looks for", () => {
  const { title, body } = discussionFor(clock);
  assert.equal(title, "时钟 / Clock (com.example.clock)");
  assert.equal(pluginOf(body), "com.example.clock");
  assert.match(body, /https:\/\/github\.com\/example\/clock\/issues/);
  assert.equal(pluginOf("no marker here"), null);
});

test("only 👍 counts", () => {
  assert.equal(thumbsUp({ reactionGroups: likes(4) }), 4);
  assert.equal(thumbsUp({ reactionGroups: [] }), 0);
});

test("stars.json lists the plugins with a discussion; the oldest discussion of a plugin wins", () => {
  const discussions = [
    { number: 7, url: "https://github.com/TixXin/fuyu-plugins/discussions/7", body: discussionFor(clock).body, reactionGroups: likes(1) },
    { number: 3, url: "https://github.com/TixXin/fuyu-plugins/discussions/3", body: discussionFor(clock).body, reactionGroups: likes(5) },
    { number: 9, url: "https://github.com/TixXin/focusd-plugins/discussions/9", body: "<!-- focusd-plugin: gone.plugin -->", reactionGroups: likes(2) },
  ];
  const stars = buildStars([clock, timer], discussions, "2026-11-09T00:00:00.000Z");
  assert.deepEqual(stars, {
    version: 1,
    updatedAt: "2026-11-09T00:00:00.000Z",
    plugins: { "com.example.clock": { count: 5, url: "https://github.com/TixXin/focusd-plugins/discussions/3" } },
  });
});

test("a new time alone is no change", () => {
  const plugins = { "com.example.clock": { count: 5, url: "u" } };
  assert.ok(sameStars({ version: 1, updatedAt: "a", plugins }, { version: 1, updatedAt: "b", plugins }));
  assert.ok(!sameStars({ version: 1, updatedAt: "a", plugins }, { version: 1, updatedAt: "a", plugins: {} }));
  assert.ok(!sameStars(null, { version: 1, updatedAt: "a", plugins }));
});

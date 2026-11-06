import assert from "node:assert/strict";
import test from "node:test";
import { buildEntry } from "../scripts/build-index.mjs";
import { indexEntry, marketText, MAX_MARKET_TEXT, reviewReasons } from "../scripts/lib/packages.mjs";

const submission = { id: "com.example.clock", repo: "example/clock", publisher: "example", categories: ["utilities"] };
const manifest = (version, permissions = [], extra = {}) => ({
  id: "com.example.clock",
  name: { "zh-CN": "时钟", en: "Clock" },
  version,
  apiVersion: 2,
  permissions,
  runtime: { type: "process", command: "node", args: ["main.mjs"] },
  ...extra,
});
const zip = Buffer.from("zip bytes");
const listed = (version, permissions = []) => indexEntry(manifest(version, permissions), submission, `https://example.com/${version}.zip`, zip);

function deps(version, permissions = [], extra = {}, docs = {}, repo = {}) {
  const calls = { fetched: 0, repoDocs: [] };
  return {
    calls,
    locatePackage: async () => ({ url: `https://example.com/${version}.zip`, version, tag: `v${version}` }),
    fetchAndInspect: async () => {
      calls.fetched += 1;
      return { zip, manifest: manifest(version, permissions, extra), docs, errors: [], warnings: [] };
    },
    repoDocs: async (submission, location) => {
      calls.repoDocs.push(location.tag);
      return repo;
    },
  };
}

test("a new plugin is listed", async () => {
  const result = await buildEntry(submission, undefined, deps("1.0.0"));
  assert.equal(result.entry.version, "1.0.0");
  assert.equal(result.entry.publisher, "example");
  assert.deepEqual(result.errors, []);
});

test("a listed version is not downloaded again", async () => {
  const d = deps("1.0.0");
  const result = await buildEntry({ ...submission, categories: ["productivity"] }, listed("1.0.0"), d);
  assert.equal(d.calls.fetched, 0);
  assert.deepEqual(result.entry.categories, ["productivity"]);
});

test("an update that keeps the permissions is listed", async () => {
  const result = await buildEntry(submission, listed("1.0.0", ["clipboard:read"]), deps("1.1.0", ["clipboard:read"]));
  assert.equal(result.entry.version, "1.1.0");
  assert.equal(result.held, null);
});

test("an update asking for more is held until approved", async () => {
  const held = await buildEntry(submission, listed("1.0.0"), deps("1.1.0", ["clipboard:read"]));
  assert.equal(held.entry.version, "1.0.0");
  assert.match(held.held.reasons.join(), /clipboard:read/);
  const approved = await buildEntry({ ...submission, approved: "1.1.0" }, listed("1.0.0"), deps("1.1.0", ["clipboard:read"]));
  assert.equal(approved.entry.version, "1.1.0");
});

test("an older release never replaces the listed version", async () => {
  const result = await buildEntry(submission, listed("1.2.0"), deps("1.1.0"));
  assert.equal(result.entry.version, "1.2.0");
  assert.match(result.warnings.join(), /older/);
});

test("a broken package keeps the listed version and reports the error", async () => {
  const d = deps("1.1.0");
  d.fetchAndInspect = async () => ({ zip, manifest: null, errors: ["bad manifest"], warnings: [] });
  const result = await buildEntry(submission, listed("1.0.0"), d);
  assert.equal(result.entry.version, "1.0.0");
  assert.deepEqual(result.errors, ["bad manifest"]);
});

test("review reasons cover permissions, webview and runtime", () => {
  const before = listed("1.0.0");
  const after = { ...before, permissions: ["media:read"], webview: true, runtime: "exe" };
  assert.equal(reviewReasons(before, after).length, 3);
  assert.deepEqual(reviewReasons(before, before), []);
});

test("README and CHANGELOG come from the package, else from the repository at the release tag", async () => {
  const packed = deps("1.0.0", [], {}, { readme: "# In the zip", changelog: "## 1.0.0" });
  const fromZip = await buildEntry(submission, undefined, packed);
  assert.equal(fromZip.entry.readme, "# In the zip");
  assert.equal(fromZip.entry.changelog, "## 1.0.0");
  assert.deepEqual(packed.calls.repoDocs, []);

  const ignored = deps("1.1.0", [], {}, { readme: "# In the zip" }, { readme: "# In the repo", changelog: "## 1.1.0" });
  const mixed = await buildEntry(submission, undefined, ignored);
  assert.equal(mixed.entry.readme, "# In the zip");
  assert.equal(mixed.entry.changelog, "## 1.1.0");
  assert.deepEqual(ignored.calls.repoDocs, ["v1.1.0"]);
});

test("docs that cannot be read only warn, and a listed version keeps its docs", async () => {
  const d = deps("1.0.0");
  d.repoDocs = async () => { throw new Error("rate limited"); };
  const result = await buildEntry(submission, undefined, d);
  assert.equal(result.entry.version, "1.0.0");
  assert.equal(result.entry.readme, undefined);
  assert.match(result.warnings.join(), /rate limited/);

  const previous = { ...listed("1.0.0"), readme: "# Kept" };
  const again = deps("1.0.0");
  const kept = await buildEntry(submission, previous, again);
  assert.equal(kept.entry.readme, "# Kept");
  assert.equal(again.calls.fetched, 0);
});

test("market texts are trimmed and cut at a line end", () => {
  assert.equal(marketText("  \r\n# Title\r\n\r\n"), "# Title");
  assert.equal(marketText("   "), null);
  const long = marketText(`${"a".repeat(MAX_MARKET_TEXT - 5)}\n${"b".repeat(100)}`);
  assert.ok(long.length <= MAX_MARKET_TEXT + 3 && long.endsWith("\n\n…") && !long.includes("b"));
});

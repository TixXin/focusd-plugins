import assert from "node:assert/strict";
import test from "node:test";
import { buildEntry } from "../scripts/build-index.mjs";
import { indexEntry, reviewReasons } from "../scripts/lib/packages.mjs";

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

function deps(version, permissions = [], extra = {}) {
  const calls = { fetched: 0 };
  return {
    calls,
    locatePackage: async () => ({ url: `https://example.com/${version}.zip`, version }),
    fetchAndInspect: async () => {
      calls.fetched += 1;
      return { zip, manifest: manifest(version, permissions, extra), errors: [], warnings: [] };
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

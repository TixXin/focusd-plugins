import assert from "node:assert/strict";
import test from "node:test";
import { buildEntry } from "../scripts/build-index.mjs";
import { fixedPackageSource, followedPackage, sourceManifestUrls, sourceVersion } from "../scripts/lib/official.mjs";
import { indexEntry } from "../scripts/lib/packages.mjs";

const RAW = "https://raw.githubusercontent.com/TixXin/fly-island/main";
const submission = {
  id: "dev.focusd.system-monitor",
  repo: "TixXin/fly-island",
  publisher: "TixXin",
  categories: ["utilities"],
  package: `${RAW}/plugins/packages/dev.focusd.system-monitor-1.2.0.zip`,
  path: "plugins/examples/dev.focusd.system-monitor",
};

test("an official package next to its source is followed to the source's newer version", () => {
  const source = fixedPackageSource(submission);
  assert.deepEqual(source, { repo: "TixXin/fly-island", ref: "main", folder: "plugins/packages", version: "1.2.0" });
  assert.deepEqual(sourceManifestUrls(submission, source), [
    `${RAW}/plugins/examples/dev.focusd.system-monitor/fuyu-plugin.json`,
    `${RAW}/plugins/examples/dev.focusd.system-monitor/focusd-plugin.json`,
  ]);
  const followed = followedPackage(submission, source, "1.3.0");
  assert.equal(followed.url, `${RAW}/plugins/packages/dev.focusd.system-monitor-1.3.0.zip`);
  assert.equal(followed.signatureUrl, `${followed.url}.sig`);
  assert.equal(followed.version, "1.3.0");
  // The same or an older version, or none, keeps the fixed address.
  assert.equal(followedPackage(submission, source, "1.2.0"), null);
  assert.equal(followedPackage(submission, source, "1.1.0"), null);
  assert.equal(followedPackage(submission, source, null), null);
  assert.equal(followedPackage(submission, source, "1.3"), null);
});

test("only a raw.githubusercontent.com zip named after the plugin, with a path, is followed", () => {
  assert.equal(fixedPackageSource({ ...submission, path: undefined }), null);
  assert.equal(fixedPackageSource({ ...submission, package: "https://example.com/dev.focusd.system-monitor-1.2.0.zip" }), null);
  assert.equal(fixedPackageSource({ ...submission, package: `${RAW}/plugins/packages/other-1.2.0.zip` }), null);
  assert.equal(fixedPackageSource({ ...submission, package: undefined }), null);
});

test("the source's version comes from the manifest under its current name, else the one from before", async () => {
  const source = fixedPackageSource(submission);
  const legacyOnly = async (url) => (url.endsWith("/focusd-plugin.json") ? JSON.stringify({ version: "1.3.0" }) : null);
  assert.equal(await sourceVersion(submission, source, legacyOnly), "1.3.0");
  const both = async (url) => JSON.stringify({ version: url.endsWith("/fuyu-plugin.json") ? "1.4.0" : "1.3.0" });
  assert.equal(await sourceVersion(submission, source, both), "1.4.0");
  assert.equal(await sourceVersion(submission, source, async () => null), null);
});

const manifest = (version, permissions = []) => ({
  id: submission.id,
  name: { "zh-CN": "系统监控", en: "System monitor" },
  version,
  apiVersion: 2,
  permissions,
  runtime: { type: "process", command: "powershell", args: ["main.ps1"] },
});
const zip = Buffer.from("zip bytes");
const listed = indexEntry(manifest("1.2.0"), submission, submission.package, zip);
const followedDeps = (version, permissions = []) => ({
  locatePackage: async () => followedPackage(submission, fixedPackageSource(submission), version),
  fetchAndInspect: async () => ({ zip, manifest: manifest(version, permissions), errors: [], warnings: [] }),
  repoDocs: async () => ({}),
});

test("a followed version is listed, and held for review when it asks for more", async () => {
  const listedNow = await buildEntry(submission, listed, followedDeps("1.3.0"));
  assert.equal(listedNow.entry.version, "1.3.0");
  assert.equal(listedNow.entry.download.url, `${RAW}/plugins/packages/dev.focusd.system-monitor-1.3.0.zip`);
  assert.equal(listedNow.held, null);
  // Not the reviewed address: more permissions wait for "approved", like a release.
  const held = await buildEntry(submission, listed, followedDeps("1.3.0", ["network"]));
  assert.equal(held.entry.version, "1.2.0");
  assert.equal(held.held.version, "1.3.0");
});

test("a fixed address older than the listed version does not replace it", async () => {
  const newer = indexEntry(manifest("1.3.0"), submission, `${RAW}/plugins/packages/dev.focusd.system-monitor-1.3.0.zip`, zip);
  const source = fixedPackageSource(submission);
  const result = await buildEntry(submission, newer, {
    locatePackage: async () => ({ url: submission.package, version: source.version, tag: null, signatureUrl: `${submission.package}.sig` }),
    fetchAndInspect: async () => assert.fail("must not download the older package"),
    repoDocs: async () => ({}),
  });
  assert.equal(result.entry.version, "1.3.0");
});

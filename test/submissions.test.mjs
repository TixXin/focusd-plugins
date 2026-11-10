import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, idKey, pickRelease, submissionErrors, versionOfTag } from "../scripts/lib/submissions.mjs";

const good = { id: "com.example.clock", repo: "example/clock", publisher: "example", categories: ["utilities"] };

test("a well-formed submission passes", () => {
  assert.deepEqual(submissionErrors(good, "com.example.clock.json"), []);
});

test("the file name, publisher, categories and reserved ids are checked", () => {
  assert.match(submissionErrors(good, "other.json").join(), /must be named com.example.clock.json/);
  assert.match(submissionErrors({ ...good, publisher: "someone" }, "com.example.clock.json").join(), /owner of "repo"/);
  assert.match(submissionErrors({ ...good, categories: ["games"] }, "com.example.clock.json").join(), /categories/);
  const reserved = { ...good, id: "com.focusd.clock" };
  assert.match(submissionErrors(reserved, "com.focusd.clock.json").join(), /reserved/);
  assert.match(submissionErrors({ ...good, id: "com.fuyu.clock" }, "com.fuyu.clock.json").join(), /reserved/);
  assert.match(submissionErrors({ ...good, extra: 1 }, "com.example.clock.json").join(), /unknown field "extra"/);
});

test("only the official publisher may use a fixed package address", () => {
  const withPackage = { ...good, package: "https://example.com/a.zip" };
  assert.match(submissionErrors(withPackage, "com.example.clock.json").join(), /only for the official publisher/);
  const official = { id: "dev.focusd.x", repo: "TixXin/fly-island", publisher: "TixXin", package: "https://example.com/a.zip" };
  assert.deepEqual(submissionErrors(official, "dev.focusd.x.json"), []);
});

test("approved must be a version", () => {
  assert.match(submissionErrors({ ...good, approved: "latest" }, "com.example.clock.json").join(), /approved/);
  assert.deepEqual(submissionErrors({ ...good, approved: "1.2.0" }, "com.example.clock.json"), []);
});

test("versions compare numerically, pre-releases first", () => {
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.2.0-beta.1", "1.2.0"), -1);
  assert.equal(compareVersions("1.2.0", "1.2.0"), 0);
});

test("tags name versions with an optional prefix and v", () => {
  assert.equal(versionOfTag("v1.2.3"), "1.2.3");
  assert.equal(versionOfTag("1.2.3"), "1.2.3");
  assert.equal(versionOfTag("clock-v1.2.3", "clock-"), "1.2.3");
  assert.equal(versionOfTag("other-v1.2.3", "clock-"), null);
  assert.equal(versionOfTag("nightly"), null);
});

test("ids that differ only in dots and dashes look alike", () => {
  assert.equal(idKey("com.example.my-clock"), idKey("com.example.myclock"));
});

const release = (tag, { draft = false, prerelease = false, asset = true } = {}) => ({
  tag_name: tag,
  draft,
  prerelease,
  assets: asset ? [{ name: `com.example.clock-${tag.replace(/^v/, "")}.zip`, browser_download_url: `https://example.com/${tag}.zip` }] : [],
});

test("the newest published release with the right asset is picked", () => {
  const releases = [release("v2.0.0", { draft: true }), release("v1.3.0", { prerelease: true }), release("v1.2.0", { asset: false }), release("v1.10.0"), release("v1.9.0")];
  assert.deepEqual(pickRelease(releases, good), { version: "1.10.0", url: "https://example.com/v1.10.0.zip", tag: "v1.10.0", signatureUrl: null });
  assert.equal(pickRelease(releases, { ...good, preRelease: true }).version, "1.10.0");
  assert.equal(pickRelease([release("v1.3.0", { prerelease: true })], { ...good, preRelease: true }).version, "1.3.0");
  assert.equal(pickRelease([release("v1.2.0", { asset: false })], good), null);
});

test("path must be a folder inside the repository", () => {
  for (const folder of ["plugins/clock", "src", "a.b/c_d-e"]) {
    assert.deepEqual(submissionErrors({ ...good, path: folder }, "com.example.clock.json"), [], folder);
  }
  for (const folder of ["/plugins", "../x", "a/../b", "a//b", "a/", ".", "a b", 3]) {
    assert.match(submissionErrors({ ...good, path: folder }, "com.example.clock.json").join(), /"path"/, String(folder));
  }
});

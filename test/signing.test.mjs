import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { buildEntry } from "../scripts/build-index.mjs";
import { indexEntry } from "../scripts/lib/packages.mjs";
import { keyIdOf, signedText, signingKeyErrors, verifyPackage } from "../scripts/lib/signing.mjs";
import { pickRelease, submissionErrors } from "../scripts/lib/submissions.mjs";

const { privateKey } = generateKeyPairSync("ed25519");
const raw = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(12);
const key = { keyId: keyIdOf(raw), publicKey: raw.toString("base64") };
const signed = (id, version, sha) => ({ keyId: key.keyId, signature: sign(null, Buffer.from(signedText(id, version, sha)), privateKey).toString("base64") });

const submission = { id: "com.example.clock", repo: "example/clock", publisher: "example", categories: [], signingKeys: [key] };
const manifest = (version) => ({ id: "com.example.clock", name: { "zh-CN": "时钟", en: "Clock" }, version, apiVersion: 2, permissions: [], runtime: { type: "process", command: "main.mjs" } });
const zip = Buffer.from("zip bytes");
const listed = (version) => indexEntry(manifest(version), submission, `https://example.com/${version}.zip`, zip);

/** deps whose signature download answers `signature` (or an error result). */
function deps(version, readAuthorSignature) {
  return {
    locatePackage: async () => ({ url: `https://example.com/${version}.zip`, version, tag: `v${version}`, signatureUrl: "https://example.com/sig" }),
    fetchAndInspect: async () => ({ zip, manifest: manifest(version), docs: {}, errors: [], warnings: [] }),
    repoDocs: async () => ({}),
    readAuthorSignature,
  };
}
const goodSignature = async (sub, location, sha, id, version) =>
  verifyPackage(id, version, sha, signed(id, version, sha), sub.signingKeys) ? { fields: { authorSignature: signed(id, version, sha), authorKeys: sub.signingKeys } } : { error: "bad" };

test("signingKeys must be keys as keygen prints them", () => {
  assert.deepEqual(signingKeyErrors([key]), []);
  assert.deepEqual(submissionErrors(submission, "com.example.clock.json"), []);
  assert.equal(signingKeyErrors([]).length, 1);
  assert.equal(signingKeyErrors([{ ...key, keyId: "0000000000000000" }]).length, 1);
  assert.equal(signingKeyErrors([{ ...key, extra: 1 }]).length, 1);
  assert.match(submissionErrors({ ...submission, signingKeys: "x" }, "com.example.clock.json").join(), /signingKeys/);
});

test("a package signature holds only for its plugin, version and bytes", () => {
  const sha = "ab".repeat(32);
  assert.equal(verifyPackage("com.example.clock", "1.0.0", sha, signed("com.example.clock", "1.0.0", sha), [key]), key.keyId);
  assert.equal(verifyPackage("com.example.clock", "1.0.1", sha, signed("com.example.clock", "1.0.0", sha), [key]), null);
  assert.equal(verifyPackage("com.example.other", "1.0.0", sha, signed("com.example.clock", "1.0.0", sha), [key]), null);
  assert.equal(verifyPackage("com.example.clock", "1.0.0", "cd".repeat(32), signed("com.example.clock", "1.0.0", sha), [key]), null);
});

test("the release's .sig asset is found", () => {
  const assets = [{ name: "com.example.clock-1.0.0.zip", browser_download_url: "z" }, { name: "com.example.clock-1.0.0.zip.sig", browser_download_url: "s" }];
  assert.equal(pickRelease([{ tag_name: "v1.0.0", assets }], submission).signatureUrl, "s");
});

test("a signed release is listed with its signature; an unsigned one is held even when approved", async () => {
  const listedSigned = await buildEntry(submission, undefined, deps("1.0.0", goodSignature));
  assert.equal(listedSigned.entry.authorSignature.keyId, key.keyId);
  assert.deepEqual(listedSigned.entry.authorKeys, [key]);

  const missing = async () => ({ error: "has no author signature" });
  const held = await buildEntry({ ...submission, approved: "1.1.0" }, listed("1.0.0"), deps("1.1.0", missing));
  assert.equal(held.entry.version, "1.0.0");
  assert.equal(held.held.unsigned, true);
  assert.match(held.held.reasons.join(), /no author signature/);
});

test("a listed version without a signature gets one; a signed one is left alone", async () => {
  const added = await buildEntry(submission, listed("1.0.0"), deps("1.0.0", goodSignature));
  assert.equal(added.entry.version, "1.0.0");
  assert.equal(added.entry.authorSignature.keyId, key.keyId);

  const failing = async () => { throw new Error("must not be read"); };
  const kept = await buildEntry(submission, added.entry, deps("1.0.0", failing));
  assert.deepEqual(kept.entry.authorSignature, added.entry.authorSignature);

  const notYet = await buildEntry(submission, listed("1.0.0"), deps("1.0.0", async () => ({ error: "has no author signature" })));
  assert.equal(notYet.entry.authorSignature, undefined);
  assert.match(notYet.warnings.join(), /no author signature/);
});

test("without signingKeys nothing changes", async () => {
  const { signingKeys, ...plain } = submission;
  const failing = async () => { throw new Error("must not be read"); };
  const result = await buildEntry(plain, undefined, deps("1.0.0", failing));
  assert.equal(result.entry.version, "1.0.0");
  assert.equal(result.entry.authorSignature, undefined);
  assert.ok(signingKeys);
});

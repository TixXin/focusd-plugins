import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildEntry } from "../scripts/build-index.mjs";
import { runCli } from "../scripts/lib/packages.mjs";
import { checkSource, differences } from "../scripts/lib/source.mjs";

const submission = { id: "com.example.clock", repo: "example/clock", publisher: "example", path: "plugin" };
const manifest = {
  id: "com.example.clock",
  name: { "zh-CN": "钟", en: "Clock" },
  description: { "zh-CN": "钟", en: "Clock" },
  version: "1.0.0",
  apiVersion: 2,
  runtime: { type: "process", command: "main.mjs" },
  permissions: [],
};

function workspace(files) {
  const root = mkdtempSync(path.join(tmpdir(), "fuyu-source-test-"));
  const folder = path.join(root, "clock-1.0.0", "plugin");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "fuyu-plugin.json"), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(folder, name), text);
  return { root, folder };
}

function pack(folder, out) {
  assert.ok(runCli(["pack", folder, "--out", out]).ok);
  return readFileSync(path.join(out, readdirSync(out).find((name) => name.endsWith(".zip"))));
}

function tarball(root) {
  const file = path.join(root, "source.tar.gz");
  assert.equal(spawnSync("tar", ["-czf", file, "-C", root, "clock-1.0.0"]).status, 0);
  return readFileSync(file);
}

async function compare(sourceFiles, releaseFiles) {
  const source = workspace(sourceFiles);
  const release = workspace(releaseFiles);
  try {
    const zip = pack(release.folder, path.join(release.root, "out"));
    const archive = tarball(source.root);
    return await checkSource(submission, { tag: "v1.0.0" }, zip, async () => archive);
  } finally {
    rmSync(source.root, { recursive: true, force: true });
    rmSync(release.root, { recursive: true, force: true });
  }
}

test("a release packed from the source at its tag matches", async () => {
  assert.deepEqual(await compare({ "main.mjs": "console.log(1);\n" }, { "main.mjs": "console.log(1);\n" }), { match: true });
});

test("a release with a file the source does not have is named", async () => {
  const result = await compare({ "main.mjs": "1\n" }, { "main.mjs": "1\n", "extra.mjs": "steal()\n" });
  assert.equal(result.match, false);
  assert.match(result.reason, /has files the source does not: extra\.mjs/);
});

test("a release whose file differs from the source is named", async () => {
  const result = await compare({ "main.mjs": "1\n" }, { "main.mjs": "2\n" });
  assert.equal(result.match, false);
  assert.match(result.reason, /these files differ: main\.mjs/);
});

test("a tag missing from the repository does not match", async () => {
  const result = await checkSource(submission, { tag: "v9.9.9" }, Buffer.from("zip"), async () => null);
  assert.deepEqual(result, { match: false, reason: "names the tag v9.9.9, which is not in example/clock" });
});

test("fixed addresses and declared build steps are not compared", async () => {
  const never = async () => assert.fail("no download");
  assert.ok((await checkSource(submission, { tag: null }, Buffer.from(""), never)).skipped);
  assert.ok((await checkSource({ ...submission, buildStep: true }, { tag: "v1.0.0" }, Buffer.from(""), never)).skipped);
});

test("differences list at most eight names per kind", () => {
  const released = new Map(Array.from({ length: 10 }, (_, index) => [`f${index}.mjs`, "a"]));
  assert.deepEqual(differences(released, new Map()), ["the release has files the source does not: f0.mjs, f1.mjs, f2.mjs, f3.mjs, f4.mjs, f5.mjs, f6.mjs, f7.mjs and 2 more"]);
});

test("a matching release is marked, a different one is held until approved", async () => {
  const zip = Buffer.from("zip bytes");
  const deps = (source) => ({
    locatePackage: async () => ({ url: "https://example.com/1.1.0.zip", version: "1.1.0", tag: "v1.1.0" }),
    fetchAndInspect: async () => ({ zip, manifest: { ...manifest, version: "1.1.0" }, docs: { readme: "x", changelog: "y" }, errors: [], warnings: [] }),
    repoDocs: async () => ({}),
    checkSource: async () => source,
  });
  const previous = { ...manifest, id: submission.id, runtime: "node", permissions: [], download: { url: "https://example.com/1.0.0.zip" } };
  const listed = await buildEntry(submission, previous, deps({ match: true }));
  assert.equal(listed.entry.sourceMatch, true);
  const held = await buildEntry(submission, previous, deps({ match: false, reason: "is not what it should be" }));
  assert.equal(held.entry, previous);
  assert.deepEqual(held.held, { id: submission.id, version: "1.1.0", reasons: ["is not what it should be"] });
  const approved = await buildEntry({ ...submission, approved: "1.1.0" }, previous, deps({ match: false, reason: "differs" }));
  assert.equal(approved.entry.version, "1.1.0");
  assert.equal(approved.entry.sourceMatch, undefined);
  const first = await buildEntry(submission, undefined, deps({ match: false, reason: "differs" }));
  assert.equal(first.entry, null);
  assert.ok(first.held);
  const built = await buildEntry({ ...submission, buildStep: true }, previous, deps({ skipped: "the plugin declares a build step" }));
  assert.equal(built.entry.version, "1.1.0");
});

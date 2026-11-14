// Checks that a release asset holds the same files `fuyu-plugin pack` makes from
// the repository at the release tag (the zip bytes may differ between versions of pack), so the source a maintainer reads is the code
// users install. Nothing from the repository is run: it is unpacked and packed.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { download } from "./github.mjs";
import { runCli } from "./packages.mjs";
import { extractZip } from "./zip.mjs";

/** Largest source archive downloaded for the check. */
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_LISTED = 8;
const MANIFEST = "fuyu-plugin.json";
const LEGACY_MANIFEST = "focusd-plugin.json";

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** The repository at `tag` as a .tar.gz, or null when the tag does not exist. */
export async function downloadSource(repo, tag) {
  try {
    return await download(`https://codeload.github.com/${repo}/tar.gz/refs/tags/${encodeURIComponent(tag)}`, MAX_SOURCE_BYTES);
  } catch (error) {
    if (/ answered 404\.$/.test(error.message)) return null;
    throw error;
  }
}

function filesOf(dir, prefix = "") {
  const files = new Map();
  for (const entry of readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) for (const [inner, hash] of filesOf(dir, `${name}/`)) files.set(inner, hash);
    else if (entry.isFile()) files.set(name, sha256(readFileSync(path.join(dir, name))));
  }
  return files;
}

/**
 * The files of an unpacked package by name and hash. The copy of fuyu-plugin.json that
 * newer `fuyu-plugin pack` adds as focusd-plugin.json is left out, so packages
 * made by different versions of pack compare by the plugin's own files.
 */
function contentsOf(dir) {
  const files = filesOf(dir);
  if (files.has(LEGACY_MANIFEST) && files.get(LEGACY_MANIFEST) === files.get(MANIFEST)) files.delete(LEGACY_MANIFEST);
  return files;
}

/** What differs between two unpacked packages, as short sentences. */
export function differences(released, built) {
  const added = [...released.keys()].filter((name) => !built.has(name)).sort();
  const missing = [...built.keys()].filter((name) => !released.has(name)).sort();
  const changed = [...released.keys()].filter((name) => built.has(name) && built.get(name) !== released.get(name)).sort();
  const list = (names) => `${names.slice(0, MAX_LISTED).join(", ")}${names.length > MAX_LISTED ? ` and ${names.length - MAX_LISTED} more` : ""}`;
  return [
    ...(added.length ? [`the release has files the source does not: ${list(added)}`] : []),
    ...(missing.length ? [`the release lacks files of the source: ${list(missing)}`] : []),
    ...(changed.length ? [`these files differ: ${list(changed)}`] : []),
  ];
}

/**
 * Packs the source at the release tag and compares it with `zip`.
 * Returns { skipped: reason } (no tag, or a declared build step), { match: true },
 * or { match: false, reason } where reason reads after "the release".
 */
export async function checkSource(submission, location, zip, fetchSource = downloadSource) {
  if (!location.tag) return { skipped: "the package has a fixed address, not a release tag" };
  if (submission.buildStep === true) return { skipped: "the plugin declares a build step" };
  const archive = await fetchSource(submission.repo, location.tag);
  if (!archive) return { match: false, reason: `names the tag ${location.tag}, which is not in ${submission.repo}` };
  const dir = mkdtempSync(path.join(tmpdir(), "fuyu-source-"));
  try {
    const file = path.join(dir, "source.tar.gz");
    writeFileSync(file, archive);
    mkdirSync(path.join(dir, "source"));
    const unpacked = spawnSync("tar", ["-xzf", file, "-C", path.join(dir, "source")], { encoding: "utf8" });
    if (unpacked.status !== 0) return { match: false, reason: `has a source archive at ${location.tag} that could not be unpacked` };
    const [top] = readdirSync(path.join(dir, "source"));
    const folder = path.join(dir, "source", top ?? "", submission.path ?? "");
    if (!top || !existsSync(folder) || !statSync(folder).isDirectory()) {
      return { match: false, reason: `has no folder ${submission.path ?? "(the repository root)"} at ${location.tag}` };
    }
    const packed = runCli(["pack", folder, "--out", path.join(dir, "built")]);
    const built = existsSync(path.join(dir, "built")) ? readdirSync(path.join(dir, "built")).filter((name) => name.endsWith(".zip")) : [];
    if (!packed.ok || built.length !== 1) return { match: false, reason: `has source at ${location.tag} that \`fuyu-plugin pack\` fails on` };
    const builtZip = readFileSync(path.join(dir, "built", built[0]));
    if (sha256(builtZip) === sha256(zip)) return { match: true };
    extractZip(zip, path.join(dir, "released-files"));
    extractZip(builtZip, path.join(dir, "built-files"));
    const found = differences(contentsOf(path.join(dir, "released-files")), contentsOf(path.join(dir, "built-files")));
    if (found.length === 0) return { match: true };
    return { match: false, reason: `is not what \`fuyu-plugin pack\` makes from the source at ${location.tag} (${found.join("; ")})` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

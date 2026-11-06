// Finds a submission's package, checks it the way the island and the market
// do (fly-island-plugin validate), and turns it into an index entry.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { download, downloadTextIfPresent, listReleases } from "./github.mjs";
import { pickRelease } from "./submissions.mjs";
import { extractZip } from "./zip.mjs";

export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
/** Longest README / CHANGELOG text carried in the index (MAX_MARKET_TEXT in the island's plugin_host/market.rs). */
export const MAX_MARKET_TEXT = 16 * 1024;
const MAX_DOC_BYTES = 256 * 1024;
const DOCS = { readme: "README.md", changelog: "CHANGELOG.md" };
const MANIFEST = "focusd-plugin.json";
const CLI = path.join(path.dirname(fileURLToPath(import.meta.resolve("fly-island-plugin/package.json"))), "bin", "fly-island-plugin.mjs");

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Where the newest package of a submission is: { url, version|null, tag|null }, or null when there is none. */
export async function locatePackage(submission) {
  if (submission.package) return { url: submission.package, version: null, tag: null };
  return pickRelease(await listReleases(submission.repo), submission);
}

function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

/** Trimmed text, cut at a line end to MAX_MARKET_TEXT characters; null when empty. Same as the island's build-plugin-index.mjs. */
export function marketText(text, limit = MAX_MARKET_TEXT) {
  const trimmed = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!trimmed) return null;
  if (trimmed.length <= limit) return trimmed;
  const cut = trimmed.slice(0, limit);
  const lineEnd = cut.lastIndexOf("\n");
  return `${(lineEnd > 0 ? cut.slice(0, lineEnd) : cut).trimEnd()}\n\n…`;
}

/** { readme?, changelog? } from README.md / CHANGELOG.md read by `read(fileName)` (null when missing). */
async function collectDocs(read) {
  const docs = {};
  for (const [key, fileName] of Object.entries(DOCS)) {
    const text = marketText(await read(fileName));
    if (text) docs[key] = text;
  }
  return docs;
}

/**
 * README.md / CHANGELOG.md for the market page when the package leaves them out
 * (.focusdignore): read from the repository at the release tag (at main for a
 * fixed "package" address), in the submission's "path" folder.
 */
export async function repoDocs(submission, location) {
  const ref = location.tag ?? "HEAD";
  const folder = submission.path ? `${submission.path}/` : "";
  return collectDocs((fileName) =>
    downloadTextIfPresent(`https://raw.githubusercontent.com/${submission.repo}/${encodeURIComponent(ref)}/${folder}${fileName}`, MAX_DOC_BYTES));
}

/**
 * Unpacks and validates a package. `expected` is { id, version|null }.
 * Returns { manifest, docs: { readme?, changelog? }, errors, warnings }.
 */
export async function inspectPackage(zip, expected) {
  const errors = [];
  const warnings = [];
  const dir = mkdtempSync(path.join(tmpdir(), "focusd-plugin-"));
  try {
    try {
      extractZip(zip, path.join(dir, "plugin"));
    } catch (error) {
      return { manifest: null, errors: [error.message], warnings };
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path.join(dir, "plugin", MANIFEST), "utf8").trimStart());
    } catch {
      return { manifest: null, errors: [`The package has no readable ${MANIFEST} at its root.`], warnings };
    }
    const validation = runCli(["validate", path.join(dir, "plugin")]);
    for (const line of validation.output.split(/\r?\n/)) {
      if (line.startsWith("error: ")) errors.push(line.slice(7));
      else if (line.startsWith("warning: ")) warnings.push(line.slice(9));
    }
    if (!validation.ok && errors.length === 0) errors.push(`fly-island-plugin validate failed: ${validation.output}`);
    if (manifest.id !== expected.id) errors.push(`The manifest id is "${manifest.id}", not "${expected.id}".`);
    if (expected.version && manifest.version !== expected.version) {
      errors.push(`The manifest version is "${manifest.version}", but the release tag says ${expected.version}.`);
    }
    if (errors.length === 0) {
      const packed = runCli(["pack", path.join(dir, "plugin"), "--out", path.join(dir, "repacked")]);
      const file = path.join(dir, "repacked", `${manifest.id}-${manifest.version}.zip`);
      let same = false;
      try {
        same = packed.ok && sha256(readFileSync(file)) === sha256(zip);
      } catch {
        same = false;
      }
      if (!same) warnings.push("Packing the unpacked files again gives a different zip; build the release asset with `fly-island-plugin pack` so it can be reproduced.");
    }
    const docs = await collectDocs((fileName) => {
      const file = path.join(dir, "plugin", fileName);
      return existsSync(file) ? readFileSync(file, "utf8") : null;
    });
    return { manifest, docs, errors, warnings };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Downloads and inspects the package at `location` ({ url, version }). Returns { zip, manifest, docs, errors, warnings }. */
export async function fetchAndInspect(submission, location) {
  const zip = await download(location.url, MAX_PACKAGE_BYTES);
  return { zip, ...(await inspectPackage(zip, { id: submission.id, version: location.version })) };
}

/** What the plugin needs installed, like runtime_requirement in the island's plugin_host/manifest.rs. */
export function runtimeRequirement(runtime) {
  if (runtime?.type !== "process") return "none";
  const extension = path.extname(runtime.command ?? "").toLowerCase();
  if (extension === ".exe") return "exe";
  if (extension === ".ps1") return "powershell";
  if ([".js", ".mjs", ".cjs"].includes(extension)) return "node";
  return "none";
}

/** The market details a submission adds to its entry. */
export function marketDetails(submission) {
  return {
    publisher: submission.publisher,
    repo: submission.repo,
    categories: [...new Set(submission.categories ?? [])],
    ...(submission.preRelease === true ? { preRelease: true } : {}),
  };
}

/** The index entry (same shape as MarketEntry in the island's plugin_host/market.rs). */
export function indexEntry(manifest, submission, url, zip, docs = {}) {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description ?? { "zh-CN": "", en: "" },
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    ...(manifest.minAppVersion ? { minAppVersion: manifest.minAppVersion } : {}),
    author: manifest.author ?? "",
    homepage: manifest.homepage ?? "",
    permissions: [...new Set(manifest.permissions ?? [])].sort(),
    runtime: runtimeRequirement(manifest.runtime),
    ...((manifest.contributes?.views ?? []).some((view) => view.template === "webview") ? { webview: true } : {}),
    ...marketDetails(submission),
    ...(docs.readme ? { readme: docs.readme } : {}),
    ...(docs.changelog ? { changelog: docs.changelog } : {}),
    download: { url, sha256: sha256(zip), size: zip.length },
  };
}

/**
 * Why an automatic update needs a person to look first (empty when it does not):
 * more permissions, a first page with its own HTML, or a different runtime.
 */
export function reviewReasons(previous, next) {
  const reasons = [];
  const added = next.permissions.filter((permission) => !previous.permissions.includes(permission));
  if (added.length > 0) reasons.push(`asks for new permissions: ${added.join(", ")}`);
  if (next.webview && !previous.webview) reasons.push("adds a page with its own HTML (webview)");
  if ((next.runtime ?? "none") !== (previous.runtime ?? "none")) reasons.push(`changes the runtime from ${previous.runtime} to ${next.runtime}`);
  return reasons;
}

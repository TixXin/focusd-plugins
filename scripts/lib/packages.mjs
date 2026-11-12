// Finds a submission's package, checks it the way the island and the market
// do (fuyu-plugin validate), and turns it into an index entry.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { download, downloadTextIfPresent, listReleases } from "./github.mjs";
import { fixedPackageSource, followedPackage, sourceVersion } from "./official.mjs";
import { pickRelease } from "./submissions.mjs";
import { scanFolder } from "./secrets.mjs";
import { MAX_SIGNATURE_BYTES, parseSignature, verifyPackage } from "./signing.mjs";
import { extractZip } from "./zip.mjs";

export const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
/** Longest README / CHANGELOG text carried in the index (MAX_MARKET_TEXT in the island's plugin_host/market.rs). */
export const MAX_MARKET_TEXT = 16 * 1024;
const MAX_DOC_BYTES = 256 * 1024;
const DOCS = { readme: "README.md", changelog: "CHANGELOG.md" };
/** The manifest name since the rename first, then the name plugins made before it carry; the island reads them in this order. */
const MANIFESTS = ["fuyu-plugin.json", "focusd-plugin.json"];
const CLI = path.join(path.dirname(fileURLToPath(import.meta.resolve("fuyu-plugin/package.json"))), "bin", "fuyu-plugin.mjs");

export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Where the newest package of a submission is: { url, version|null, tag|null, signatureUrl|null }, or null when there is none. */
export async function locatePackage(submission) {
  if (submission.package) {
    // An official plugin's source may already be newer than its fixed address (lib/official.mjs).
    const source = fixedPackageSource(submission);
    const followed = source && followedPackage(submission, source, await sourceVersion(submission, source));
    if (followed) return followed;
    // The version the address names, so a newer listed version is never replaced by it.
    return { url: submission.package, version: source?.version ?? null, tag: null, signatureUrl: `${submission.package}.sig` };
  }
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
 * (.fuyuignore, or .focusdignore before the rename): read from the repository at the release tag (at main for a
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
    const manifestName = MANIFESTS.find((name) => existsSync(path.join(dir, "plugin", name))) ?? MANIFESTS[0];
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path.join(dir, "plugin", manifestName), "utf8").trimStart());
    } catch {
      return { manifest: null, errors: [`The package has no readable ${MANIFESTS.join(" or ")} at its root.`], warnings };
    }
    const validation = runCli(["validate", path.join(dir, "plugin")]);
    for (const line of validation.output.split(/\r?\n/)) {
      if (line.startsWith("error: ")) errors.push(line.slice(7));
      else if (line.startsWith("warning: ")) warnings.push(line.slice(9));
    }
    if (!validation.ok && errors.length === 0) errors.push(`fuyu-plugin validate failed: ${validation.output}`);
    // A credential in a public package is leaked for good; the author has to revoke it and publish again.
    for (const { file, line, kind } of scanFolder(path.join(dir, "plugin"))) {
      errors.push(`${file}:${line} looks like a ${kind}. Revoke it, remove it from the package and publish a new version.`);
    }
    if (manifest.id !== expected.id) errors.push(`The manifest id is "${manifest.id}", not "${expected.id}".`);
    if (expected.version && manifest.version !== expected.version) {
      errors.push(`The manifest version is "${manifest.version}", but the release tag says ${expected.version}.`);
    }
    if (errors.length === 0) {
      // `fuyu-plugin pack` adds a copy of fuyu-plugin.json as focusd-plugin.json right after it, for islands
      // from before the rename. Left in the folder, the copy would sort first and change the repacked zip.
      const [current, legacy] = MANIFESTS.map((name) => path.join(dir, "plugin", name));
      if (existsSync(current) && existsSync(legacy) && readFileSync(current).equals(readFileSync(legacy))) rmSync(legacy);
      const packed = runCli(["pack", path.join(dir, "plugin"), "--out", path.join(dir, "repacked")]);
      const file = path.join(dir, "repacked", `${manifest.id}-${manifest.version}.zip`);
      let same = false;
      try {
        same = packed.ok && sha256(readFileSync(file)) === sha256(zip);
      } catch {
        same = false;
      }
      if (!same) warnings.push("Packing the unpacked files again gives a different zip; build the release asset with `fuyu-plugin pack` so it can be reproduced.");
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

/**
 * The author signature of a package for a submission with "signingKeys":
 * { fields: { authorSignature, authorKeys } } to add to the index entry, or
 * { error } saying why it cannot be listed.
 */
export async function readAuthorSignature(submission, location, sha256, id, version) {
  const name = `${id}-${version}.zip.sig`;
  if (!location.signatureUrl) return { error: `has no author signature (${name}) although plugins/${id}.json lists signingKeys` };
  const text = await downloadTextIfPresent(location.signatureUrl, MAX_SIGNATURE_BYTES);
  if (text === null) return { error: `has no author signature (${name}) although plugins/${id}.json lists signingKeys` };
  const signature = parseSignature(text);
  if (!signature || !verifyPackage(id, version, sha256, signature, submission.signingKeys)) {
    return { error: `its author signature (${name}) is not made by a key in signingKeys` };
  }
  return { fields: { authorSignature: signature, authorKeys: submission.signingKeys } };
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

/**
 * Permissions the plugin asks for while it runs (manifest optionalPermissions,
 * API version 2), without those in `permissions`; like the island's manifest.rs.
 * They need no review on update: the island asks the user each time.
 */
export function optionalPermissions(manifest) {
  if ((manifest.apiVersion ?? 1) < 2) return [];
  const required = new Set(manifest.permissions ?? []);
  return [...new Set(manifest.optionalPermissions ?? [])].filter((name) => !required.has(name)).sort();
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
    ...(optionalPermissions(manifest).length > 0 ? { optionalPermissions: optionalPermissions(manifest) } : {}),
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

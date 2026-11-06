// plugins/<id>.json: what an author submits. The index entry itself is built
// from the package (see build-index.mjs); this file only says where the
// package comes from and how the market lists it.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { signingKeyErrors } from "./signing.mjs";

export const PLUGINS_DIR = "plugins";
/** The island's own publisher (OFFICIAL_PUBLISHER in the island's plugin_host/market.rs). */
export const OFFICIAL_PUBLISHER = "TixXin";
/** Categories the market page offers (MARKET_CATEGORIES in the island's src/features/plugins/api.ts). */
export const CATEGORIES = ["productivity", "todos", "developer", "media", "messages", "information", "utilities"];
const ID_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;
const REPO_PATTERN = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const KEYS = new Set(["id", "repo", "publisher", "categories", "preRelease", "tagPrefix", "package", "approved", "path", "signingKeys"]);
/** A folder inside the repository: segments of letters, digits, ".", "_" and "-", no ".." and no leading "/". */
const FOLDER_PATTERN = /^(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export const isOfficial = (publisher) => publisher?.toLowerCase() === OFFICIAL_PUBLISHER.toLowerCase();
export const ownerOf = (repo) => repo.split("/")[0];

/** Problems with one submission (an empty list when it is fine). `fileName` is "<id>.json". */
export function submissionErrors(submission, fileName) {
  const errors = [];
  if (typeof submission !== "object" || submission === null || Array.isArray(submission)) return ["must be a JSON object."];
  for (const key of Object.keys(submission)) if (!KEYS.has(key)) errors.push(`unknown field "${key}".`);
  const { id, repo, publisher, categories = [], preRelease, tagPrefix, package: packageUrl, approved, path: folder, signingKeys } = submission;
  if (typeof id !== "string" || id.length < 3 || id.length > 64 || !ID_PATTERN.test(id) || id.includes("..")) {
    errors.push(`"id" must be 3-64 characters of a-z, 0-9, "." and "-", like the plugin manifest.`);
  } else if (fileName !== `${id}.json`) {
    errors.push(`the file must be named ${id}.json.`);
  }
  if (typeof repo !== "string" || !REPO_PATTERN.test(repo)) errors.push(`"repo" must be "owner/name" of a GitHub repository.`);
  if (typeof publisher !== "string" || publisher.length === 0) errors.push(`"publisher" must be the GitHub user or organization.`);
  else if (typeof repo === "string" && publisher.toLowerCase() !== ownerOf(repo).toLowerCase()) {
    errors.push(`"publisher" must be the owner of "repo" (${ownerOf(repo)}).`);
  }
  if (!isOfficial(publisher) && typeof id === "string" && id.includes("focusd")) {
    errors.push(`ids containing "focusd" are reserved for the official publisher.`);
  }
  if (!Array.isArray(categories) || categories.some((name) => !CATEGORIES.includes(name))) {
    errors.push(`"categories" may only list: ${CATEGORIES.join(", ")}.`);
  }
  if (preRelease !== undefined && typeof preRelease !== "boolean") errors.push(`"preRelease" must be true or false.`);
  if (tagPrefix !== undefined && (typeof tagPrefix !== "string" || /\s/.test(tagPrefix))) errors.push(`"tagPrefix" must be a string without spaces.`);
  if (approved !== undefined && (typeof approved !== "string" || !VERSION_PATTERN.test(approved))) {
    errors.push(`"approved" must be the version a maintainer reviewed, like "1.2.0".`);
  }
  if (folder !== undefined && (typeof folder !== "string" || folder.length > 200 || !FOLDER_PATTERN.test(folder))) {
    errors.push(`"path" must be a folder of the repository, like "plugins/clock", without ".." or a leading "/".`);
  }
  if (signingKeys !== undefined) errors.push(...signingKeyErrors(signingKeys, id));
  if (packageUrl !== undefined) {
    if (!isOfficial(publisher)) errors.push(`"package" (a fixed download address) is only for the official publisher; others publish GitHub releases.`);
    else if (typeof packageUrl !== "string" || !packageUrl.startsWith("https://")) errors.push(`"package" must be an https:// address.`);
  }
  return errors;
}

/** Every plugins/*.json as { fileName, submission }, sorted by file name. */
export function loadSubmissions(root) {
  const dir = path.join(root, PLUGINS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((fileName) => ({ fileName, submission: JSON.parse(readFileSync(path.join(dir, fileName), "utf8")) }));
}

/** Ids that read the same once dots and dashes are dropped are too easy to mistake for each other. */
export const idKey = (id) => id.replace(/[^a-z0-9]/g, "");

/** -1, 0 or 1. Pre-releases ("1.2.0-beta.1") sort before their release. */
export function compareVersions(left, right) {
  const [leftCore, leftPre = ""] = left.split(/-(.*)/s);
  const [rightCore, rightPre = ""] = right.split(/-(.*)/s);
  const a = leftCore.split(".").map(Number);
  const b = rightCore.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  if (leftPre === rightPre) return 0;
  if (!leftPre) return 1;
  if (!rightPre) return -1;
  return leftPre < rightPre ? -1 : 1;
}

/** The version a release tag names: `<tagPrefix>[v]<x.y.z>`, or null when the tag does not fit. */
export function versionOfTag(tag, tagPrefix = "") {
  if (!tag.startsWith(tagPrefix)) return null;
  const rest = tag.slice(tagPrefix.length).replace(/^v/, "");
  return VERSION_PATTERN.test(rest) ? rest : null;
}

/**
 * The newest usable release of a submission: published, a tag that names a
 * version, and the asset `<id>-<version>.zip`. Pre-releases only with
 * "preRelease": true. Returns { version, url, tag, signatureUrl } or null;
 * signatureUrl is the release's <zip>.sig asset, null when it has none.
 */
export function pickRelease(releases, submission) {
  const candidates = [];
  for (const release of releases) {
    if (release.draft || (release.prerelease && submission.preRelease !== true)) continue;
    const version = versionOfTag(release.tag_name ?? "", submission.tagPrefix);
    if (!version) continue;
    const asset = (release.assets ?? []).find((item) => item.name === `${submission.id}-${version}.zip`);
    const signature = (release.assets ?? []).find((item) => item.name === `${submission.id}-${version}.zip.sig`);
    if (asset) candidates.push({ version, url: asset.browser_download_url, tag: release.tag_name, signatureUrl: signature?.browser_download_url ?? null });
  }
  candidates.sort((left, right) => compareVersions(right.version, left.version));
  return candidates[0] ?? null;
}

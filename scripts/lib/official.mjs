// Official plugins have a fixed "package" address: a zip in the island's repository, next to the
// plugin's source. Updating that address by hand after every release was easy to forget (the
// system monitor stayed at 1.2.0 while 1.2.3 and 1.3.0 were packaged), so the index follows the
// source: when the manifest in the "path" folder, at the same ref as the package, names a newer
// version, the package of that version in the same folder is used. The island's repository only
// lets a version reach that branch packaged and signed (`pnpm plugins:index`, checked by its
// tests), and the author signature is still checked here as for any version.
import { downloadTextIfPresent } from "./github.mjs";
import { compareVersions } from "./submissions.mjs";

const MAX_MANIFEST_BYTES = 256 * 1024;
/** Read in this order, as the island reads them. */
const MANIFESTS = ["fuyu-plugin.json", "focusd-plugin.json"];
const VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`;
const RAW_PACKAGE = new RegExp(String.raw`^https://raw\.githubusercontent\.com/([^/]+/[^/]+)/([^/]+)/(.+)/([^/]+)-(${VERSION})\.zip$`);

/**
 * Where a fixed package comes from: { repo, ref, folder, version }, or null when the address is
 * not a raw.githubusercontent.com zip named <id>-<version>.zip or the submission has no "path".
 */
export function fixedPackageSource(submission) {
  if (!submission.package || !submission.path) return null;
  const match = RAW_PACKAGE.exec(submission.package);
  if (!match || match[4] !== submission.id) return null;
  return { repo: match[1], ref: match[2], folder: match[3], version: match[5] };
}

/** The addresses of the source's manifest, in the order to try. */
export function sourceManifestUrls(submission, source) {
  return MANIFESTS.map((name) => `https://raw.githubusercontent.com/${source.repo}/${source.ref}/${submission.path}/${name}`);
}

/**
 * The package of `sourceVersion` when it is newer than the fixed one:
 * { url, version, tag: null, signatureUrl }, else null.
 */
export function followedPackage(submission, source, sourceVersion) {
  if (typeof sourceVersion !== "string" || !new RegExp(`^${VERSION}$`).test(sourceVersion)) return null;
  if (compareVersions(sourceVersion, source.version) <= 0) return null;
  const url = `https://raw.githubusercontent.com/${source.repo}/${source.ref}/${source.folder}/${submission.id}-${sourceVersion}.zip`;
  return { url, version: sourceVersion, tag: null, signatureUrl: `${url}.sig` };
}

/** The version the source's manifest names, or null when it has none (or no manifest). */
export async function sourceVersion(submission, source, read = (url) => downloadTextIfPresent(url, MAX_MANIFEST_BYTES)) {
  for (const url of sourceManifestUrls(submission, source)) {
    const text = await read(url);
    if (text === null) continue;
    return JSON.parse(text).version ?? null;
  }
  return null;
}

// Rebuilds index.json from plugins/*.json. For each plugin it finds the newest
// package (the newest GitHub release, or the fixed "package" address of an
// official plugin), checks it and lists it. A version that is already listed
// is never downloaded again, and a listed version never changes. An automatic
// update that asks for more (permissions, webview, runtime) is held back and
// reported for review instead of being listed. Signing is scripts/sign.mjs.
//
// Usage: node scripts/build-index.mjs   (exit code 1 when a plugin had errors;
// index.json is still written with everything that worked)
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./lib/github.mjs";
import { fetchAndInspect, indexEntry, locatePackage, marketDetails, reviewReasons } from "./lib/packages.mjs";
import { compareVersions, loadSubmissions, submissionErrors } from "./lib/submissions.mjs";

export const INDEX_PATH = "index.json";
export const INDEX_VERSION = 1;

function readIndex(root) {
  const file = path.join(root, INDEX_PATH);
  if (!existsSync(file)) return new Map();
  const index = JSON.parse(readFileSync(file, "utf8"));
  return new Map((index.plugins ?? []).map((entry) => [entry.id, entry]));
}

/** One plugin: { entry|null, held|null, errors, warnings }. */
export async function buildEntry(submission, previous, deps = { locatePackage, fetchAndInspect }) {
  const location = await deps.locatePackage(submission);
  if (!location) {
    const error = `No release of ${submission.repo} has a tag like ${submission.tagPrefix ?? ""}v1.2.3 with the asset ${submission.id}-<version>.zip.`;
    return { entry: previous ?? null, held: null, errors: previous ? [] : [error], warnings: previous ? [error] : [] };
  }
  const unchanged = previous && (location.version ? location.version === previous.version : location.url === previous.download.url);
  if (unchanged) return { entry: { ...previous, ...marketDetails(submission) }, held: null, errors: [], warnings: [] };
  if (previous && location.version && compareVersions(location.version, previous.version) < 0) {
    return { entry: { ...previous, ...marketDetails(submission) }, held: null, errors: [], warnings: [`The newest release (${location.version}) is older than the listed ${previous.version}; keeping ${previous.version}.`] };
  }

  const { zip, manifest, errors, warnings } = await deps.fetchAndInspect(submission, location);
  if (errors.length > 0) return { entry: previous ?? null, held: null, errors, warnings };
  const entry = indexEntry(manifest, submission, location.url, zip);
  if (previous && compareVersions(entry.version, previous.version) === 0) {
    return { entry: { ...previous, ...marketDetails(submission) }, held: null, errors: [`${entry.version} is already listed with a different package; publish a new version.`], warnings };
  }
  // A fixed "package" address only changes through a reviewed pull request, and
  // "approved" names a version a maintainer has looked at.
  const reviewed = submission.package || submission.approved === entry.version;
  const reasons = previous && !reviewed ? reviewReasons(previous, entry) : [];
  if (reasons.length > 0) return { entry: previous, held: { id: entry.id, version: entry.version, reasons }, errors: [], warnings };
  return { entry, held: null, errors: [], warnings };
}

/** Opens one issue per held update (unless it is already open). Needs GITHUB_TOKEN with issues: write. */
async function reportHeld(held) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !process.env.GITHUB_TOKEN) return;
  for (const { id, version, reasons } of held) {
    const title = `Review needed: ${id} ${version}`;
    const { body } = await api(`/repos/${repo}/issues?state=open&labels=review-needed&per_page=100`);
    if (Array.isArray(body) && body.some((issue) => issue.title === title)) continue;
    await api(`/repos/${repo}/issues`, {
      method: "POST",
      body: {
        title,
        labels: ["review-needed"],
        body: `The newest release of \`${id}\` (${version}) was not listed automatically because it ${reasons.join("; ")}.\n\nTo list it, review the release and merge a pull request that sets \`"approved": "${version}"\` in \`plugins/${id}.json\`. The next index build lists it; then close this issue.`,
      },
    });
  }
}

export async function buildIndex(root) {
  const previous = readIndex(root);
  const entries = [];
  const held = [];
  const report = [];
  let failed = false;
  for (const { fileName, submission } of loadSubmissions(root)) {
    const shape = submissionErrors(submission, fileName);
    if (shape.length > 0) {
      failed = true;
      report.push(`- ❌ plugins/${fileName}: ${shape.join(" ")}`);
      if (previous.has(submission?.id)) entries.push(previous.get(submission.id));
      continue;
    }
    let result;
    try {
      result = await buildEntry(submission, previous.get(submission.id));
    } catch (error) {
      result = { entry: previous.get(submission.id) ?? null, held: null, errors: [error.message], warnings: [] };
    }
    if (result.entry) entries.push(result.entry);
    if (result.held) held.push(result.held);
    if (result.errors.length > 0) failed = true;
    for (const error of result.errors) report.push(`- ❌ ${submission.id}: ${error}`);
    for (const warning of result.warnings) report.push(`- ⚠️ ${submission.id}: ${warning}`);
    if (result.held) report.push(`- ⏸️ ${submission.id} ${result.held.version} held for review: ${result.held.reasons.join("; ")}`);
  }
  entries.sort((left, right) => left.id.localeCompare(right.id));
  writeFileSync(path.join(root, INDEX_PATH), `${JSON.stringify({ version: INDEX_VERSION, plugins: entries }, null, 2)}\n`);
  return { entries, held, report, failed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { entries, held, report, failed } = await buildIndex(root);
  const summary = [`### Index: ${entries.length} plugin(s)`, ...entries.map((entry) => `- ${entry.id} ${entry.version}`), "", ...report].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  await reportHeld(held);
  if (failed) process.exitCode = 1;
}

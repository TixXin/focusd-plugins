// Checks a pull request (runs without secrets, on `pull_request`):
// - authors who are not maintainers may only add or change plugins/<id>.json;
// - each changed submission is well formed, its id is free and not easy to
//   confuse with another, and the author owns the repository it points to;
// - its newest package is found, downloaded and validated like the index build
//   does, and what it asks for is listed for the reviewer;
// - revoked.json keeps its format.
//
// Environment: BASE_SHA, PR_AUTHOR, AUTHOR_ASSOCIATION (from the workflow),
// GITHUB_TOKEN (optional, for the API rate limit), GITHUB_STEP_SUMMARY.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./lib/github.mjs";
import { fetchAndInspect, indexEntry, locatePackage } from "./lib/packages.mjs";
import { PLUGINS_DIR, idKey, loadSubmissions, ownerOf, submissionErrors } from "./lib/submissions.mjs";
import { revokedErrors } from "./sign.mjs";

const MAINTAINERS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const SUBMISSION_FILE = /^plugins\/[^/]+\.json$/;

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

/** [{ status, file }] changed between the base and HEAD. */
function changedFiles(base) {
  return git(["diff", "--name-status", "--no-renames", `${base}...HEAD`])
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [status, file] = line.split("\t");
      return { status, file };
    });
}

/** True when `user` is the owner of `repo`, or a public member of the organization that owns it. */
export async function ownsRepo(user, repo) {
  const owner = ownerOf(repo);
  if (owner.toLowerCase() === user.toLowerCase()) return true;
  const { status } = await api(`/orgs/${owner}/public_members/${user}`);
  return status === 204;
}

function describe(entry, warnings) {
  const lines = [
    `#### ${entry.id} ${entry.version}`,
    `- Publisher: ${entry.publisher} · repository: https://github.com/${entry.repo}`,
    `- Runtime: ${entry.runtime}${entry.webview ? " · **has pages with its own HTML (webview)**" : ""}`,
    `- Permissions: ${entry.permissions.length > 0 ? entry.permissions.map((name) => `\`${name}\``).join(", ") : "none"}`,
    `- Package: ${entry.download.url} (${entry.download.size} bytes, sha256 \`${entry.download.sha256}\`)`,
  ];
  for (const warning of warnings) lines.push(`- ⚠️ ${warning}`);
  lines.push("", "Before merging, read the plugin's source at that release.");
  return lines;
}

export async function checkPullRequest(root, { base, author, association }) {
  const errors = [];
  const notes = [];
  const maintainer = MAINTAINERS.has(association);
  const changes = changedFiles(base);

  for (const { status, file } of changes) {
    if (maintainer) continue;
    if (!SUBMISSION_FILE.test(file)) errors.push(`${file}: only maintainers may change files outside plugins/.`);
    else if (status === "D") errors.push(`${file}: ask a maintainer to remove a plugin (open an issue).`);
  }

  if (changes.some(({ file }) => file === "revoked.json")) {
    const list = JSON.parse(readFileSync(path.join(root, "revoked.json"), "utf8"));
    for (const error of revokedErrors(list)) errors.push(error);
  }

  const all = loadSubmissions(root);
  const changed = changes.filter(({ status, file }) => status !== "D" && SUBMISSION_FILE.test(file)).map(({ file }) => path.basename(file));
  for (const fileName of changed) {
    const { submission } = all.find((item) => item.fileName === fileName) ?? {};
    const shape = submissionErrors(submission, fileName);
    if (shape.length > 0) {
      for (const error of shape) errors.push(`plugins/${fileName}: ${error}`);
      continue;
    }
    const twin = all.find((item) => item.fileName !== fileName && idKey(item.submission.id ?? "") === idKey(submission.id));
    if (twin) errors.push(`plugins/${fileName}: the id is too close to ${twin.submission.id}.`);

    if (!maintainer) {
      if (!(await ownsRepo(author, submission.repo))) {
        errors.push(`plugins/${fileName}: @${author} must own ${submission.repo} (be its owner, or a public member of its organization).`);
      }
      const before = spawnSync("git", ["show", `${base}:${PLUGINS_DIR}/${fileName}`], { encoding: "utf8" });
      if (before.status === 0) {
        const old = JSON.parse(before.stdout);
        if (old.repo !== submission.repo && !(await ownsRepo(author, old.repo))) {
          errors.push(`plugins/${fileName}: only the owner of ${old.repo} may move the plugin to another repository.`);
        }
      }
    }

    try {
      const location = await locatePackage(submission);
      if (!location) {
        errors.push(`${submission.id}: no release of ${submission.repo} has a tag like ${submission.tagPrefix ?? ""}v1.2.3 with the asset ${submission.id}-<version>.zip.`);
        continue;
      }
      const result = await fetchAndInspect(submission, location);
      for (const error of result.errors) errors.push(`${submission.id}: ${error}`);
      if (result.errors.length === 0) notes.push(...describe(indexEntry(result.manifest, submission, location.url, result.zip), result.warnings), "");
    } catch (error) {
      errors.push(`${submission.id}: ${error.message}`);
    }
  }
  return { errors, notes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const base = process.env.BASE_SHA;
  if (!base || !existsSync(path.join(root, ".git"))) {
    console.error("Run in a git checkout with BASE_SHA set to the pull request's base commit.");
    process.exit(1);
  }
  const { errors, notes } = await checkPullRequest(root, {
    base,
    author: process.env.PR_AUTHOR ?? "",
    association: process.env.AUTHOR_ASSOCIATION ?? "NONE",
  });
  const summary = [
    errors.length > 0 ? "### ❌ The submission needs changes" : "### ✅ Checks passed",
    ...errors.map((error) => `- ${error}`),
    "",
    ...notes,
  ].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  if (errors.length > 0) process.exitCode = 1;
}

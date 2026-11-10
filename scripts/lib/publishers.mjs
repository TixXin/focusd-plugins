// "Verified" publishers (plugin-author-signing.md §4 in TixXin/fuyu): the
// market shows that a publisher really is who the name suggests. Not a safety
// rating of the plugin.
//
// - A GitHub organization that verified a domain with GitHub (is_verified) is
//   verified without doing anything; GitHub does not say publicly which domain.
// - Anyone else lists "domain" in the submission and serves
//   https://<domain>/.well-known/focusd-publisher.json containing { "github": "<publisher>" }.
//
// Checked at every index build. A check that cannot reach GitHub or the domain
// keeps the previous state; only a definite answer adds or removes the mark.
import { api } from "./github.mjs";
import { isOfficial } from "./submissions.mjs";

export const WELL_KNOWN = ".well-known/focusd-publisher.json";
const MAX_PROOF_BYTES = 4096;
const TIMEOUT_MS = 10_000;

/** GET https://<domain>/.well-known/focusd-publisher.json: { status, text }; never follows redirects. */
async function fetchProof(domain) {
  const response = await fetch(`https://${domain}/${WELL_KNOWN}`, {
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "User-Agent": "fuyu-plugins-index", Accept: "application/json" },
  });
  const text = Buffer.from(await response.arrayBuffer());
  if (text.length > MAX_PROOF_BYTES) return { status: response.status, text: null };
  return { status: response.status, text: text.toString("utf8") };
}

/**
 * { state: "verified", verified: { via, domain? } } | { state: "unverified", reason } |
 * { state: "unknown", reason } (could not check) | { state: "official" }.
 */
export async function checkPublisher(publisher, domain, deps = { api, fetchProof }) {
  if (isOfficial(publisher)) return { state: "official" };
  if (domain) {
    let proof;
    try {
      proof = await deps.fetchProof(domain);
    } catch (error) {
      return { state: "unknown", reason: `https://${domain}/${WELL_KNOWN} could not be read: ${error.message}` };
    }
    if (proof.status >= 500) return { state: "unknown", reason: `https://${domain}/${WELL_KNOWN} answered ${proof.status}.` };
    if (proof.status !== 200) return { state: "unverified", reason: `https://${domain}/${WELL_KNOWN} answered ${proof.status}.` };
    let github;
    try {
      github = JSON.parse(proof.text ?? "")?.github;
    } catch {
      github = undefined;
    }
    if (typeof github !== "string" || github.toLowerCase() !== publisher.toLowerCase()) {
      return { state: "unverified", reason: `https://${domain}/${WELL_KNOWN} must be { "github": "${publisher}" } (at most ${MAX_PROOF_BYTES} bytes).` };
    }
    return { state: "verified", verified: { via: "domain", domain } };
  }
  const { status, body } = await deps.api(`/orgs/${encodeURIComponent(publisher)}`);
  if (status === 200 && body?.is_verified === true) return { state: "verified", verified: { via: "github" } };
  if (status === 200 || status === 404) return { state: "unverified", reason: `${publisher} is not a GitHub organization with a verified domain; list "domain" to verify another way.` };
  return { state: "unknown", reason: `GitHub answered ${status} for the organization ${publisher}.` };
}

/**
 * Sets or clears `verified` on the index entries, one check per publisher and
 * domain. `submissions` maps plugin id to its submission. Returns report lines.
 */
export async function applyVerification(entries, submissions, deps) {
  const results = new Map();
  const report = [];
  for (const entry of entries) {
    const submission = submissions.get(entry.id);
    if (!submission) continue;
    const key = `${submission.publisher.toLowerCase()}|${submission.domain ?? ""}`;
    if (!results.has(key)) {
      const result = await checkPublisher(submission.publisher, submission.domain, deps);
      results.set(key, result);
      if (result.state === "verified") report.push(`- ✅ ${submission.publisher} is verified (${result.verified.domain ?? "GitHub organization"}).`);
      else if (result.state === "unknown") report.push(`- ⚠️ ${submission.publisher}: ${result.reason} Keeping the previous state.`);
      else if (result.state === "unverified" && submission.domain) report.push(`- ❌ ${submission.publisher}: ${result.reason}`);
    }
    const result = results.get(key);
    if (result.state === "verified") entry.verified = result.verified;
    else if (result.state !== "unknown") delete entry.verified;
  }
  return report;
}

export { fetchProof };

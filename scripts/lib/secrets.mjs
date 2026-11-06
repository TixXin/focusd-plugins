// Looks for credentials left in a plugin package: access tokens and private
// keys in well-known formats. Only formats with a recognisable prefix are
// matched, so ordinary code does not trip it. A finding names the file, the
// line and the kind of credential, never the value itself (the check output
// is public).
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Files larger than this are not read (packages are at most 20 MB anyway). */
const MAX_SCANNED_BYTES = 2 * 1024 * 1024;

export const SECRET_PATTERNS = [
  { kind: "GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/ },
  { kind: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { kind: "AWS access key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "private key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/ },
  { kind: "Slack token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { kind: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: "OpenAI or Anthropic API key", pattern: /\bsk-(?:ant-[a-z0-9]{2,8}-|proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { kind: "Stripe live key", pattern: /\b[rs]k_live_[0-9A-Za-z]{24,}\b/ },
];

/** [{ line, kind }] for the credentials in `text`, one per line and kind. */
export function findSecrets(text) {
  const found = [];
  text.split(/\r?\n/).forEach((content, index) => {
    for (const { kind, pattern } of SECRET_PATTERNS) {
      if (pattern.test(content)) found.push({ line: index + 1, kind });
    }
  });
  return found;
}

/** Binary files (a NUL byte near the start) are skipped. */
const isBinary = (buffer) => buffer.subarray(0, 8000).includes(0);

/** [{ file, line, kind }] for every credential in the files under `dir`; `file` is relative with "/". */
export function scanFolder(dir, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...scanFolder(full, `${name}/`));
      continue;
    }
    if (!entry.isFile() || statSync(full).size > MAX_SCANNED_BYTES) continue;
    const buffer = readFileSync(full);
    if (isBinary(buffer)) continue;
    for (const hit of findSecrets(buffer.toString("utf8"))) found.push({ file: name, ...hit });
  }
  return found;
}

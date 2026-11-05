// Signs index.json and revoked.json with Ed25519, the format the island checks
// (plugin_host/signature.rs; scripts/plugins/plugin-signing.mjs in the island
// repository). The private key is the PEM text in FOCUSD_PLUGIN_SIGNING_KEY,
// an environment secret of the "release" environment.
//
//   node scripts/sign.mjs          sign
//   node scripts/sign.mjs --check  verify against keys/trusted.json only
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SIGNED_FILES = ["index.json", "revoked.json"];
export const TRUSTED_KEYS = "keys/trusted.json";
// DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** CRLF becomes LF before signing, so a CRLF checkout verifies too. */
export const signedBytes = (text) => Buffer.from(text.replaceAll("\r\n", "\n"), "utf8");
export const rawPublicKey = (publicKey) => publicKey.export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX.length);
export const keyIdOf = (raw) => createHash("sha256").update(raw).digest("hex").slice(0, 16);

export function signText(text, privateKey) {
  const raw = rawPublicKey(createPublicKey(privateKey));
  return { keyId: keyIdOf(raw), signature: sign(null, signedBytes(text), privateKey).toString("base64") };
}

export function verifyText(text, signature, trustedKeys) {
  if (Array.isArray(signature)) return signature.some((one) => verifyText(text, one, trustedKeys));
  const trusted = trustedKeys.find((key) => key.keyId === signature?.keyId);
  if (!trusted || typeof signature.signature !== "string") return false;
  const publicKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(trusted.publicKey, "base64")]), format: "der", type: "spki" });
  return verify(null, signedBytes(text), publicKey, Buffer.from(signature.signature, "base64"));
}

/** revoked.json must be { version: 1, revoked: [{ id, versions: "*" | [...], reason: { "zh-CN", en }, action }] }. */
export function revokedErrors(list) {
  if (list?.version !== 1 || !Array.isArray(list.revoked)) return [`revoked.json must be { "version": 1, "revoked": [...] }.`];
  const errors = [];
  list.revoked.forEach((item, index) => {
    const where = `revoked[${index}]`;
    if (typeof item?.id !== "string" || item.id.length === 0) errors.push(`${where}.id is missing.`);
    if (item?.versions !== "*" && !(Array.isArray(item?.versions) && item.versions.length > 0 && item.versions.every((v) => typeof v === "string"))) {
      errors.push(`${where}.versions must be "*" or a list of versions.`);
    }
    if (typeof item?.reason?.["zh-CN"] !== "string" || typeof item?.reason?.en !== "string") errors.push(`${where}.reason needs "zh-CN" and "en".`);
    if (!["disable", "uninstall"].includes(item?.action)) errors.push(`${where}.action must be "disable" or "uninstall".`);
  });
  return errors;
}

export function signAll(root, privateKey) {
  const revoked = path.join(root, "revoked.json");
  if (!existsSync(revoked)) writeFileSync(revoked, `${JSON.stringify({ version: 1, revoked: [] }, null, 2)}\n`);
  const errors = revokedErrors(JSON.parse(readFileSync(revoked, "utf8")));
  if (errors.length > 0) throw new Error(errors.join("\n"));
  for (const name of SIGNED_FILES) {
    const text = readFileSync(path.join(root, name), "utf8");
    writeFileSync(path.join(root, `${name}.sig`), `${JSON.stringify(signText(text, privateKey), null, 2)}\n`);
  }
}

export function checkAll(root) {
  const trusted = JSON.parse(readFileSync(path.join(root, TRUSTED_KEYS), "utf8")).keys;
  return SIGNED_FILES.filter((name) => {
    const text = readFileSync(path.join(root, name), "utf8");
    const signature = JSON.parse(readFileSync(path.join(root, `${name}.sig`), "utf8"));
    return !verifyText(text, signature, trusted);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (process.argv[2] === "--check") {
    const bad = checkAll(root);
    if (bad.length > 0) {
      console.error(`Not signed by a key in ${TRUSTED_KEYS}: ${bad.join(", ")}`);
      process.exit(1);
    }
    console.log(`${SIGNED_FILES.join(" and ")} are signed by a trusted key.`);
  } else {
    const pem = process.env.FOCUSD_PLUGIN_SIGNING_KEY;
    if (!pem?.trim()) {
      console.error("FOCUSD_PLUGIN_SIGNING_KEY is not set.");
      process.exit(1);
    }
    signAll(root, createPrivateKey(pem));
    const bad = checkAll(root);
    if (bad.length > 0) {
      console.error(`The signing key is not in ${TRUSTED_KEYS}; the island would refuse ${bad.join(", ")}.`);
      process.exit(1);
    }
    console.log(`Signed ${SIGNED_FILES.join(" and ")}.`);
  }
}

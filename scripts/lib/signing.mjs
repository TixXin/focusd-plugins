// Author signatures of plugin packages, checked the same way as the island
// (src-tauri/src/plugin_host/author_signing.rs in TixXin/fly-island) and made by
// `fly-island-plugin pack --sign`: Ed25519 over
// "focusd-plugin-package/1\n<id>\n<version>\n<sha256 of the zip>", published as
// <id>-<version>.zip.sig ({ keyId, signature }) next to the zip.
import { createHash, createPublicKey, verify } from "node:crypto";

const DOMAIN = "focusd-plugin-package/1";
// DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
export const MAX_SIGNATURE_BYTES = 4096;

export const signedText = (id, version, sha256) => `${DOMAIN}\n${id}\n${version}\n${sha256.toLowerCase()}`;

/** The first 16 hex digits of the raw public key's SHA-256. */
export const keyIdOf = (raw) => createHash("sha256").update(raw).digest("hex").slice(0, 16);

/** Problems with a submission's "signingKeys" (empty when fine). */
export function signingKeyErrors(keys) {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 5) return [`"signingKeys" must list 1-5 keys printed by "fly-island-plugin keygen".`];
  const errors = [];
  for (const key of keys) {
    const raw = typeof key?.publicKey === "string" ? Buffer.from(key.publicKey, "base64") : Buffer.alloc(0);
    const extra = Object.keys(key ?? {}).filter((name) => name !== "keyId" && name !== "publicKey");
    if (raw.length !== 32 || key.keyId !== keyIdOf(raw) || extra.length > 0) {
      errors.push(`"signingKeys" has a key that is not { keyId, publicKey } as "fly-island-plugin keygen" prints it.`);
    }
  }
  return errors;
}

/** Parses a .sig file; null when it is not { keyId, signature }. */
export function parseSignature(text) {
  try {
    const value = JSON.parse(text);
    return typeof value?.keyId === "string" && typeof value?.signature === "string" ? { keyId: value.keyId, signature: value.signature } : null;
  } catch {
    return null;
  }
}

/** The keyId of the key in `keys` that made `signature`, or null. */
export function verifyPackage(id, version, sha256, signature, keys) {
  const key = keys.find((item) => item.keyId === signature?.keyId);
  if (!key) return null;
  const raw = Buffer.from(key.publicKey, "base64");
  if (raw.length !== 32 || keyIdOf(raw) !== key.keyId) return null;
  const publicKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
  return verify(null, Buffer.from(signedText(id, version, sha256)), publicKey, Buffer.from(signature.signature, "base64")) ? key.keyId : null;
}

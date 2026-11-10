// Author signatures of plugin packages, checked the same way as the island
// (src-tauri/src/plugin_host/author_signing.rs in TixXin/fuyu) and made by
// `fly-island-plugin pack --sign`: Ed25519 over
// "focusd-plugin-package/1\n<id>\n<version>\n<sha256 of the zip>", published as
// <id>-<version>.zip.sig ({ keyId, signature }) next to the zip.
//
// A key change (`fly-island-plugin keys rotate`) lists the new key with
// endorsedBy: the old key's signature of "focusd-plugin-key/1\n<id>\n<new keyId>\n<new publicKey>".
// The island takes updates on an endorsed key without asking.
import { createHash, createPublicKey, verify } from "node:crypto";

const DOMAIN = "focusd-plugin-package/1";
const KEY_DOMAIN = "focusd-plugin-key/1";
// DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
export const MAX_SIGNATURE_BYTES = 4096;

export const signedText = (id, version, sha256) => `${DOMAIN}\n${id}\n${version}\n${sha256.toLowerCase()}`;
export const endorsementText = (id, key) => `${KEY_DOMAIN}\n${id}\n${key.keyId}\n${key.publicKey}`;

/** The first 16 hex digits of the raw public key's SHA-256. */
export const keyIdOf = (raw) => createHash("sha256").update(raw).digest("hex").slice(0, 16);

const isSignature = (value) =>
  typeof value?.keyId === "string" && typeof value?.signature === "string" && Object.keys(value).length === 2;

/** The keyId of the key in `keys` that made `signature` of `text`, or null. */
function verifyText(text, signature, keys) {
  const key = keys.find((item) => item.keyId === signature?.keyId);
  if (!key || typeof signature.signature !== "string") return null;
  const raw = Buffer.from(key.publicKey, "base64");
  if (raw.length !== 32 || keyIdOf(raw) !== key.keyId) return null;
  const publicKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
  return verify(null, Buffer.from(text), publicKey, Buffer.from(signature.signature, "base64")) ? key.keyId : null;
}

/** Whether `key.endorsedBy` is a valid signature for plugin `id` by another key in `keys`. */
export function verifyEndorsement(id, key, keys) {
  return Boolean(key?.endorsedBy) && key.endorsedBy.keyId !== key.keyId && verifyText(endorsementText(id, key), key.endorsedBy, keys) !== null;
}

/** Problems with a submission's "signingKeys" for plugin `id` (empty when fine). */
export function signingKeyErrors(keys, id) {
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 5) return [`"signingKeys" must list 1-5 keys printed by "fly-island-plugin keygen".`];
  const errors = [];
  for (const key of keys) {
    const raw = typeof key?.publicKey === "string" ? Buffer.from(key.publicKey, "base64") : Buffer.alloc(0);
    const extra = Object.keys(key ?? {}).filter((name) => !["keyId", "publicKey", "endorsedBy"].includes(name));
    if (raw.length !== 32 || key.keyId !== keyIdOf(raw) || extra.length > 0) {
      errors.push(`"signingKeys" has a key that is not { keyId, publicKey } as "fly-island-plugin keygen" prints it.`);
    } else if (key.endorsedBy !== undefined && (!isSignature(key.endorsedBy) || !verifyEndorsement(id, key, keys))) {
      errors.push(`"signingKeys": the endorsedBy of ${key.keyId} is not a valid signature for ${id} by another listed key ("fly-island-plugin keys rotate" prints it).`);
    }
  }
  if (new Set(keys.map((key) => key?.keyId)).size !== keys.length) errors.push(`"signingKeys" lists a key twice.`);
  return errors;
}

/**
 * What a pull request changes in "signingKeys", for the reviewer: keys added with
 * or without an endorsement, and keys removed. Users' islands take updates on an
 * endorsed key by themselves; anything else makes every user confirm, and looks
 * exactly like a taken-over repository, so it needs the author's identity checked.
 */
export function keyChangeNotes(id, before = [], after = []) {
  const notes = [];
  const known = new Set(before.map((key) => key.keyId));
  for (const key of after.filter((item) => !known.has(item.keyId))) {
    if (before.length === 0) notes.push(`- First signing key ${key.keyId}.`);
    else if (verifyEndorsement(id, key, after)) notes.push(`- New signing key ${key.keyId}, endorsed by ${key.endorsedBy.keyId}: islands accept it without asking.`);
    else notes.push(`- ⚠️ New signing key ${key.keyId} has no endorsement from a listed key: every user has to confirm the next update. Check that the author really lost the old key before merging.`);
  }
  for (const key of before.filter((item) => !after.some((next) => next.keyId === item.keyId))) {
    notes.push(`- Signing key ${key.keyId} is removed${after.length === 0 ? "; the plugin will no longer be signed, so every user has to confirm the next update" : ""}.`);
  }
  return notes;
}

/** Parses a .sig file; null when it is not { keyId, signature }. */
export function parseSignature(text) {
  try {
    const value = JSON.parse(text);
    return isSignature(value) ? { keyId: value.keyId, signature: value.signature } : null;
  } catch {
    return null;
  }
}

/** The keyId of the key in `keys` that made `signature`, or null. */
export function verifyPackage(id, version, sha256, signature, keys) {
  return verifyText(signedText(id, version, sha256), signature, keys);
}

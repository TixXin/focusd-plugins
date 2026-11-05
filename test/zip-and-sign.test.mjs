import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { keyIdOf, rawPublicKey, revokedErrors, signText, verifyText } from "../scripts/sign.mjs";
import { readZip } from "../scripts/lib/zip.mjs";

/** A zip with stored (uncompressed) entries. */
function storedZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("zip entries are read", () => {
  const files = readZip(storedZip([["focusd-plugin.json", "{}"], ["src/main.mjs", "x"]]));
  assert.deepEqual(files.map((file) => [file.name, file.data.toString()]), [["focusd-plugin.json", "{}"], ["src/main.mjs", "x"]]);
});

test("paths that leave the folder are refused", () => {
  assert.throws(() => readZip(storedZip([["../evil.ps1", "x"]])), /unsafe path/);
  assert.throws(() => readZip(storedZip([["C:/evil.ps1", "x"]])), /unsafe path/);
});

test("signatures verify against trusted keys only, with CRLF or LF", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = rawPublicKey(publicKey);
  const trusted = [{ keyId: keyIdOf(raw), publicKey: raw.toString("base64") }];
  const signature = signText('{\n  "a": 1\n}\n', privateKey);
  assert.equal(verifyText('{\r\n  "a": 1\r\n}\r\n', signature, trusted), true);
  assert.equal(verifyText('{\n  "a": 2\n}\n', signature, trusted), false);
  assert.equal(verifyText('{\n  "a": 1\n}\n', [{ keyId: "other", signature: "x" }, signature], trusted), true);
  assert.equal(verifyText('{\n  "a": 1\n}\n', signature, []), false);
});

test("revoked.json is checked", () => {
  assert.deepEqual(revokedErrors({ version: 1, revoked: [] }), []);
  const item = { id: "a.b", versions: ["1.0.0"], reason: { "zh-CN": "原因", en: "why" }, action: "disable" };
  assert.deepEqual(revokedErrors({ version: 1, revoked: [item] }), []);
  assert.equal(revokedErrors({ version: 1, revoked: [{ ...item, action: "delete", versions: [] }] }).length, 2);
});

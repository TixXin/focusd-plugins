// Reads a plugin zip (stored or deflate entries) so a package can be checked
// without unzip tools that differ between Windows and Linux. Refuses paths
// that would leave the target folder, like the island does when it installs.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
export const MAX_FILES = 2000;
export const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;

function findEnd(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 22 - 0xffff); offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_SIGNATURE) return offset;
  }
  throw new Error("The package is not a zip file.");
}

function safeName(name) {
  const parts = name.split("/");
  if (name.startsWith("/") || name.includes("\\") || /^[A-Za-z]:/.test(name) || parts.includes("..")) {
    throw new Error(`The package contains an unsafe path: ${name}`);
  }
  return name;
}

/** The files in the zip as [{ name, data }]; folders are skipped. */
export function readZip(buffer) {
  const end = findEnd(buffer);
  const count = buffer.readUInt16LE(end + 10);
  if (count > MAX_FILES) throw new Error(`The package has ${count} entries; the island takes at most ${MAX_FILES}.`);
  let offset = buffer.readUInt32LE(end + 16);
  const files = [];
  let unpacked = 0;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error("The zip directory is damaged.");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    unpacked += size;
    if (unpacked > MAX_UNPACKED_BYTES) throw new Error("The package unpacks to more than 100 MB.");
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error(`The zip entry ${name} is damaged.`);
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
    else throw new Error(`The zip entry ${name} uses compression method ${method}; use deflate.`);
    if (data.length !== size) throw new Error(`The zip entry ${name} has the wrong size.`);
    files.push({ name: safeName(name), data });
  }
  return files;
}

/** Writes the zip's files under `dir`. */
export function extractZip(buffer, dir) {
  for (const { name, data } of readZip(buffer)) {
    const target = path.join(dir, ...name.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}

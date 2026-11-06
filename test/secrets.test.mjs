import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { findSecrets, scanFolder } from "../scripts/lib/secrets.mjs";

// Built at run time so this file holds no literal credential (push protection would flag one).
const fake = {
  github: ["gh", "p_", "a1B2".repeat(9)].join(""),
  npm: ["np", "m_", "Z9y8".repeat(9)].join(""),
  aws: ["AK", "IA", "ABCDEFGH12345678"].join(""),
  key: ["-----BEGIN ", "OPENSSH PRIVATE", " KEY-----"].join(""),
  anthropic: ["sk", "-ant-api03-", "x".repeat(40)].join(""),
};

test("credentials in well-known formats are found, by line and kind", () => {
  const text = [`const token = "${fake.github}";`, "// nothing here", `key=${fake.npm}`, fake.key].join("\n");
  assert.deepEqual(findSecrets(text), [
    { line: 1, kind: "GitHub token" },
    { line: 3, kind: "npm token" },
    { line: 4, kind: "private key" },
  ]);
  assert.deepEqual(findSecrets(`aws ${fake.aws} and ${fake.anthropic}`).map((hit) => hit.kind), ["AWS access key", "OpenAI or Anthropic API key"]);
});

test("ordinary code is not reported", () => {
  const code = [
    "const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';",
    "const ghost = 'gh_short'; const desk = 'sk-learn';",
    "-----BEGIN PUBLIC KEY-----",
  ].join("\n");
  assert.deepEqual(findSecrets(code), []);
});

test("a folder scan names relative files and skips binaries", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "focusd-secrets-"));
  try {
    mkdirSync(path.join(dir, "lib"));
    writeFileSync(path.join(dir, "lib", "config.mjs"), `export const token = "${fake.github}";\n`);
    writeFileSync(path.join(dir, "icon.png"), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(fake.github)]));
    writeFileSync(path.join(dir, "main.mjs"), "console.log('hi');\n");
    assert.deepEqual(scanFolder(dir), [{ file: "lib/config.mjs", line: 1, kind: "GitHub token" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

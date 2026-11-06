import assert from "node:assert/strict";
import test from "node:test";
import { applyVerification, checkPublisher } from "../scripts/lib/publishers.mjs";
import { submissionErrors } from "../scripts/lib/submissions.mjs";

/** deps: GitHub answers `org` for /orgs/<name>; the domain answers `proof` ({ status, text } or an Error). */
const deps = ({ org = { status: 404, body: null }, proof = { status: 404, text: "" } } = {}) => ({
  calls: [],
  async api(path) {
    this.calls.push(path);
    return org;
  },
  async fetchProof(domain) {
    this.calls.push(domain);
    if (proof instanceof Error) throw proof;
    return proof;
  },
});

test("an organization that verified a domain with GitHub is verified", async () => {
  assert.deepEqual(await checkPublisher("example", undefined, deps({ org: { status: 200, body: { is_verified: true } } })), { state: "verified", verified: { via: "github" } });
  assert.equal((await checkPublisher("example", undefined, deps({ org: { status: 200, body: { is_verified: false } } }))).state, "unverified");
  assert.equal((await checkPublisher("someone", undefined, deps())).state, "unverified", "a user, not an organization");
  assert.equal((await checkPublisher("example", undefined, deps({ org: { status: 403, body: null } }))).state, "unknown", "rate limited");
  assert.deepEqual(await checkPublisher("TixXin", undefined, deps()), { state: "official" });
});

test("a domain proves itself with .well-known/focusd-publisher.json", async () => {
  const good = deps({ proof: { status: 200, text: '{ "github": "Example" }' } });
  assert.deepEqual(await checkPublisher("example", "example.com", good), { state: "verified", verified: { via: "domain", domain: "example.com" } });
  assert.deepEqual(good.calls, ["example.com"], "the domain decides; GitHub is not asked");
  assert.equal((await checkPublisher("example", "example.com", deps({ proof: { status: 200, text: '{ "github": "someone-else" }' } }))).state, "unverified");
  assert.equal((await checkPublisher("example", "example.com", deps({ proof: { status: 200, text: "<html>" } }))).state, "unverified");
  assert.equal((await checkPublisher("example", "example.com", deps({ proof: { status: 404, text: "" } }))).state, "unverified");
  assert.equal((await checkPublisher("example", "example.com", deps({ proof: { status: 200, text: null } }))).state, "unverified", "too large");
  assert.equal((await checkPublisher("example", "example.com", deps({ proof: { status: 503, text: "" } }))).state, "unknown");
  assert.equal((await checkPublisher("example", "example.com", deps({ proof: new Error("timeout") }))).state, "unknown");
});

test("domain must be a bare host name", () => {
  const base = { id: "com.example.clock", repo: "example/clock", publisher: "example" };
  for (const domain of ["example.com", "plugins.example.co.uk"]) {
    assert.deepEqual(submissionErrors({ ...base, domain }, "com.example.clock.json"), [], domain);
  }
  for (const domain of ["https://example.com", "Example.com", "example.com:443", "example.com/x", "localhost", "127.0.0.1", 3]) {
    assert.match(submissionErrors({ ...base, domain }, "com.example.clock.json").join(), /"domain"/, String(domain));
  }
});

test("the mark is set, removed on a definite no, and kept when the check fails", async () => {
  const entry = (id, verified) => ({ id, ...(verified ? { verified } : {}) });
  const submissions = new Map([
    ["a.one", { id: "a.one", publisher: "example" }],
    ["a.two", { id: "a.two", publisher: "Example" }],
    ["b.one", { id: "b.one", publisher: "TixXin" }],
  ]);

  const verified = deps({ org: { status: 200, body: { is_verified: true } } });
  const entries = [entry("a.one"), entry("a.two"), entry("b.one", { via: "github" })];
  const report = await applyVerification(entries, submissions, verified);
  assert.deepEqual(entries.map((item) => item.verified), [{ via: "github" }, { via: "github" }, undefined]);
  assert.equal(verified.calls.length, 1, "one check per publisher");
  assert.match(report.join(), /example is verified/);

  const down = deps({ org: { status: 502, body: null } });
  await applyVerification(entries, submissions, down);
  assert.deepEqual(entries[0].verified, { via: "github" }, "kept while GitHub is down");

  await applyVerification(entries, submissions, deps({ org: { status: 200, body: { is_verified: false } } }));
  assert.equal(entries[0].verified, undefined, "removed when the organization is no longer verified");
});

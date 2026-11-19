import { expect, test } from "bun:test";
import { candidateHandoff, handoffContext } from "../scripts/preview-handoff";
import { sha256 } from "../scripts/release";

const repo = { full_name: "executablelabs/tap" };
const commit = "a".repeat(40);
const source = { commit, run: "123" };
const bytes = Buffer.from("synthetic candidate archive");
const digest = `sha256:${sha256(bytes)}`;
const run = {
  id: 123,
  path: ".github/workflows/aws-website-candidate.yml",
  event: "workflow_dispatch",
  status: "completed",
  conclusion: "success",
  head_sha: commit,
  head_branch: "main",
  head_repository: repo,
  repository: repo,
  run_attempt: 2,
};
const artifact = {
  id: 456,
  name: `tap-website-${commit}-123-2`,
  expired: false,
  digest,
  size_in_bytes: bytes.length,
  workflow_run: { id: 123, head_sha: commit },
};
const list = (item: unknown) => ({ total_count: 1, artifacts: [item] });

test("binds the handoff to one canonical run, attempt, commit and archive digest", () => {
  expect(
    candidateHandoff(source, run, list(artifact), (id) => {
      expect(id).toBe(456);
      return bytes;
    }),
  ).toEqual({
    repository: repo.full_name,
    commit,
    candidateRun: "123",
    runAttempt: 2,
    artifactId: 456,
    archiveDigest: digest,
  });
});

test.each([
  { path: ".github/workflows/check.yml" },
  { event: "pull_request" },
  { conclusion: "failure" },
  { head_sha: "b".repeat(40) },
  { head_branch: "topic" },
  { head_repository: { full_name: "fork/tap" } },
])("rejects a candidate outside the expected successful run: %j", (change) => {
  expect(() =>
    candidateHandoff(source, { ...run, ...change }, list(artifact), () => bytes),
  ).toThrow();
});

test("rejects expired, replaced, duplicate and corrupted artifacts", () => {
  for (const item of [
    list({ ...artifact, expired: true }),
    list({ ...artifact, name: `tap-website-${commit}-123-1` }),
    { total_count: 2, artifacts: [artifact, artifact] },
  ]) {
    expect(() => candidateHandoff(source, run, item, () => bytes)).toThrow();
  }
  expect(() =>
    candidateHandoff(source, run, list(artifact), () => Buffer.alloc(bytes.length)),
  ).toThrow();
});

test("rejects off-main requests and nonnumeric input before querying GitHub", () => {
  const env = {
    GITHUB_REPOSITORY: repo.full_name,
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_SHA: commit,
    CANDIDATE_RUN_ID: "123",
  };
  expect(handoffContext(env)).toEqual(source);
  expect(() => handoffContext({ ...env, GITHUB_REF: "refs/heads/topic" })).toThrow();
  expect(() => handoffContext({ ...env, CANDIDATE_RUN_ID: "../secrets" })).toThrow();
});

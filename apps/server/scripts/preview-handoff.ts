import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { sha256 } from "./release";

const repository = "executablelabs/tap";
const workflow = ".github/workflows/aws-website-candidate.yml";
const archiveLimit = 2 * 1024 * 1024;

export function handoffContext(env: NodeJS.ProcessEnv) {
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  const commit = env.GITHUB_SHA ?? "";
  assert.match(commit, /^[0-9a-f]{40}$/);
  const run = env.CANDIDATE_RUN_ID ?? "";
  assert.match(run, /^[1-9][0-9]{0,14}$/);
  return { commit, run };
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

export function candidateHandoff(
  source: ReturnType<typeof handoffContext>,
  runData: unknown,
  artifactData: unknown,
  download: (id: number) => Uint8Array,
) {
  const run = object(runData);
  assert.equal(run.id, Number(source.run));
  assert.equal(run.path, workflow);
  assert.equal(run.event, "workflow_dispatch");
  assert.equal(run.status, "completed");
  assert.equal(run.conclusion, "success");
  assert.equal(run.head_sha, source.commit);
  assert.equal(run.head_branch, "main");
  assert.equal(object(run.head_repository).full_name, repository);
  assert.equal(object(run.repository).full_name, repository);
  assert.ok(
    typeof run.run_attempt === "number" &&
      Number.isSafeInteger(run.run_attempt) &&
      run.run_attempt > 0,
  );
  const artifactList = object(artifactData);
  assert.equal(artifactList.total_count, 1);
  assert.ok(Array.isArray(artifactList.artifacts) && artifactList.artifacts.length === 1);
  const artifact = object(artifactList.artifacts[0]);
  assert.equal(artifact.name, `tap-website-${source.commit}-${source.run}-${run.run_attempt}`);
  assert.equal(artifact.expired, false);
  const { id, digest, size_in_bytes: size } = artifact;
  assert.ok(typeof id === "number" && Number.isSafeInteger(id) && id > 0);
  assert.ok(typeof digest === "string" && /^sha256:[0-9a-f]{64}$/.test(digest));
  assert.ok(
    typeof size === "number" && Number.isSafeInteger(size) && size > 0 && size <= archiveLimit,
  );
  const artifactRun = object(artifact.workflow_run);
  assert.equal(artifactRun.id, run.id);
  assert.equal(artifactRun.head_sha, source.commit);
  const archive = download(id);
  assert.equal(archive.byteLength, size);
  assert.equal(`sha256:${sha256(archive)}`, digest);
  return {
    repository,
    commit: source.commit,
    candidateRun: source.run,
    runAttempt: run.run_attempt,
    artifactId: id,
    archiveDigest: digest,
  };
}

if (import.meta.main) {
  const source = handoffContext(process.env);
  const output = process.env.GITHUB_OUTPUT;
  assert.ok(output && process.env.GH_TOKEN, "Missing GitHub runner context");
  const api = (path: string, maxBuffer: number) => {
    try {
      return execFileSync("gh", ["api", "--hostname", "github.com", path], {
        maxBuffer,
        timeout: 30000,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      throw new Error("GitHub API could not supply the candidate; no handoff emitted");
    }
  };
  const run = `repos/${repository}/actions/runs/${source.run}`;
  const result = candidateHandoff(
    source,
    JSON.parse(api(run, 1024 * 1024).toString("utf8")),
    JSON.parse(api(`${run}/artifacts?per_page=2`, 128 * 1024).toString("utf8")),
    (id) => api(`repos/${repository}/actions/artifacts/${id}/zip`, archiveLimit),
  );
  appendFileSync(output, `handoff=${JSON.stringify(result)}\n`);
}

import assert from "node:assert/strict";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { styles } from "../src/styles";
import { lambdaZip, publicAssetPolicy, releaseIdFor, sha256 } from "./release";

export function candidateIdentity(env: NodeJS.ProcessEnv) {
  const repository = "executablelabs/tap";
  const stack = "tap-prod-website";
  assert.equal(env.GITHUB_REPOSITORY, repository);
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  const commit = env.GITHUB_SHA ?? "";
  const runId = env.GITHUB_RUN_ID ?? "";
  const runAttempt = env.GITHUB_RUN_ATTEMPT ?? "";
  assert.match(commit, /^[0-9a-f]{40}$/);
  assert.match(runId, /^[1-9][0-9]*$/);
  assert.match(runAttempt, /^[1-9][0-9]*$/);
  return { repository, stack, commit, runId, runAttempt };
}

function requireEntries(directory: string, names: string[]) {
  assert.ok(lstatSync(directory).isDirectory(), "Expected a real build directory");
  assert.deepEqual(readdirSync(directory).sort(), names, "Unexpected release entries");
}

function readArtifact(path: string, maxBytes: number) {
  const info = lstatSync(path);
  assert.ok(info.isFile() && info.size > 0 && info.size <= maxBytes, "Invalid artifact file");
  return readFileSync(path);
}

export function stageCandidate(dist: string, runnerTemp: string, env: NodeJS.ProcessEnv) {
  const source = candidateIdentity(env);
  const maxLambdaBytes = 40 * 1024 * 1024;
  assert.ok(lstatSync(dist).isDirectory(), "Expected a real dist directory");
  const release = join(dist, "release");
  requireEntries(release, ["client", "lambda.zip", "manifest.json"]);
  requireEntries(join(release, "client"), ["styles.css"]);
  const css = readArtifact(join(release, "client/styles.css"), 1024 * 1024);
  assert.ok(css.equals(Buffer.from(styles)), "Stylesheet differs from website source");

  const runtime = join(dist, "runtime");
  requireEntries(runtime, ["lambda.mjs"]);
  const bundle = readArtifact(join(runtime, "lambda.mjs"), maxLambdaBytes);
  const zip = readArtifact(join(release, "lambda.zip"), maxLambdaBytes + 1024);
  assert.ok(zip.equals(lambdaZip(bundle)), "ZIP differs from the built Lambda");
  const manifestBody = {
    application: "tap",
    stack: source.stack,
    lambdaSha256: sha256(zip),
    assets: [{ key: "styles.css", sha256: sha256(css), ...publicAssetPolicy("styles.css") }],
  };
  const releaseId = releaseIdFor(manifestBody);
  const manifest = { ...manifestBody, releaseId };
  const recorded: unknown = JSON.parse(
    readArtifact(join(release, "manifest.json"), 1024 * 1024).toString("utf8"),
  );
  assert.deepEqual(recorded, manifest, "Release manifest does not match the build");

  const directory = mkdtempSync(join(runnerTemp, "tap-aws-candidate-"));
  mkdirSync(join(directory, "client"));
  writeFileSync(join(directory, "client/styles.css"), css, { flag: "wx" });
  writeFileSync(join(directory, "lambda.zip"), zip, { flag: "wx" });
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  const provenance = { ...source, releaseId, lambdaSha256: manifest.lambdaSha256 };
  writeFileSync(join(directory, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`, {
    flag: "wx",
  });
  return { directory, releaseId };
}

if (import.meta.main) {
  const { GITHUB_OUTPUT, RUNNER_TEMP } = process.env;
  assert.ok(GITHUB_OUTPUT && isAbsolute(GITHUB_OUTPUT));
  assert.ok(RUNNER_TEMP && isAbsolute(RUNNER_TEMP) && !/[\r\n]/.test(RUNNER_TEMP));
  const candidate = stageCandidate(resolve(import.meta.dir, "../dist"), RUNNER_TEMP, process.env);
  appendFileSync(
    GITHUB_OUTPUT,
    `directory=${candidate.directory}\nrelease_id=${candidate.releaseId}\n`,
  );
}

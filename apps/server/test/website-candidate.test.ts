import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRelease } from "../scripts/release";
import { stageCandidate } from "../scripts/verify-website-candidate";
import { styles } from "../src/styles";

const env = {
  GITHUB_REPOSITORY: "executablelabs/tap",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "1",
  GITHUB_RUN_ATTEMPT: "2",
};
let root: string;
let dist: string;
let release: string;
let output: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tap-website-candidate-test-"));
  dist = join(root, "dist");
  release = join(dist, "release");
  output = join(root, "output");
  const client = join(dist, "client");
  const runtime = join(dist, "runtime");
  const lambda = join(runtime, "lambda.mjs");
  mkdirSync(client, { recursive: true });
  mkdirSync(runtime);
  mkdirSync(output);
  writeFileSync(join(client, "styles.css"), styles);
  writeFileSync(lambda, "export const handler = () => {};\n");
  createRelease("tap", "tap-prod-website", client, lambda, release);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("stages exactly the verified CSS, ZIP, manifest and provenance", () => {
  const result = stageCandidate(dist, output, env);
  const expected = ["client", "lambda.zip", "manifest.json", "provenance.json"];
  expect(readdirSync(result.directory).sort()).toEqual(expected);
  expect(readdirSync(join(result.directory, "client"))).toEqual(["styles.css"]);
  const read = (file: string) => readFileSync(join(result.directory, file));
  expect(read("lambda.zip")).toEqual(readFileSync(join(release, "lambda.zip")));
  expect(read("client/styles.css").toString()).toBe(styles);
  const manifest = JSON.parse(read("manifest.json").toString());
  expect(manifest.releaseId).toBe(result.releaseId);
  expect(JSON.parse(read("provenance.json").toString())).toEqual({
    repository: "executablelabs/tap",
    stack: "tap-prod-website",
    commit: env.GITHUB_SHA,
    runId: "1",
    runAttempt: "2",
    releaseId: result.releaseId,
    lambdaSha256: manifest.lambdaSha256,
  });
});

test.each([
  { GITHUB_REF: "refs/heads/sdk/preview" },
  { GITHUB_REPOSITORY: "fork/tap" },
  { GITHUB_EVENT_NAME: "pull_request" },
])("rejects an unauthorized workflow context %j", (overrides) => {
  expect(() => stageCandidate(dist, output, { ...env, ...overrides })).toThrow();
  expect(readdirSync(output)).toEqual([]);
});

test.each([
  ["lambda.zip", "corrupt archive", "ZIP differs"],
  ["client/styles.css", "unreviewed stylesheet", "Stylesheet differs"],
  ["manifest.json", "{}", "Release manifest does not match"],
  ["unexpected.txt", "synthetic unlisted file", "Unexpected release entries"],
])("rejects unexpected contents at %s before staging", (file, contents, reason) => {
  writeFileSync(join(release, file), contents);
  expect(() => stageCandidate(dist, output, env)).toThrow(reason);
  expect(readdirSync(output)).toEqual([]);
});

test("does not read a release through a linked directory", () => {
  const client = join(release, "client");
  rmSync(join(client, "styles.css"));
  rmSync(client, { recursive: true });
  symlinkSync(join(dist, "client"), client, "junction");
  expect(() => stageCandidate(dist, output, env)).toThrow("Expected a real build directory");
  expect(readdirSync(output)).toEqual([]);
});

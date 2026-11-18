import { beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import * as pulumi from "@pulumi/pulumi";
import { z } from "zod";
import { createRelease } from "../../scripts/release";
import { createInfrastructure } from "../src/infrastructure";
import { viewerFunctionCode } from "../src/viewer";

const hostname = "tap.test.invalid";
const alias = "www.tap.test.invalid";
const records: { type: string; inputs: Record<string, unknown> }[] = [];
const resources: pulumi.Resource[] = [];
const object = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
const array = (value: unknown) => z.array(z.record(z.string(), z.unknown())).parse(value);
const inputs = (type: string) => {
  const entry = records.find((record) => record.type === type);
  if (!entry) throw new Error(`Missing SDK resource: ${type}`);
  return entry.inputs;
};
const resolveUrn = (resource: pulumi.Resource) =>
  new Promise<string>((resolve) => {
    resource.urn.apply((urn) => {
      resolve(urn);
      return urn;
    });
  });
beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), "tap-cloudfront-repair-"));
  const client = join(directory, "client");
  mkdirSync(client);
  writeFileSync(join(client, "styles.css"), "body{color:black}");
  const lambda = join(directory, "lambda.mjs");
  writeFileSync(lambda, "export const handler=()=>{};");
  const releaseDirectory = join(directory, "release");
  const manifest = createRelease("tap", "tap-prod-website", client, lambda, releaseDirectory);
  await pulumi.runtime.setMocks(
    {
      newResource(args) {
        const value = object(args.inputs);
        records.push({ type: args.type, inputs: value });
        return {
          id: `${args.name}-id`,
          state: {
            ...value,
            arn: `arn:aws:mock::123456789012:${args.name}`,
            version: "1",
            functionUrl: "https://test.lambda-url.eu-west-1.on.aws/",
            domainName: "test.cloudfront.net",
            bucketRegionalDomainName: "test.s3.eu-west-1.amazonaws.com",
          },
        };
      },
      call(args) {
        throw new Error(`Cloud lookup prohibited: ${args.token}`);
      },
    },
    "tap-infrastructure",
    "tap-prod-website",
    false,
  );
  await pulumi.runtime.runInPulumiStack(async () => {
    pulumi.runtime.registerStackTransformation((args) => {
      resources.push(args.resource);
      return undefined;
    });
    createInfrastructure(
      {
        environment: "prod",
        phase: "release",
        accountId: "123456789012",
        region: "eu-west-1",
        hostname,
        redirectHosts: [alias],
        certificateArn:
          "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
        monthlyBudgetUsd: 5,
        approvalReference: "TEST-CLOUDFRONT-REPAIR",
        memoryMiB: 256,
        reservedConcurrency: 2,
        routing: "manual",
        adoption: "create-only",
        releaseDirectory,
        assetsVerifiedReleaseId: manifest.releaseId,
      },
      { project: "tap-infrastructure", stack: "tap-prod-website" },
    );
    await Promise.all(resources.map(resolveUrn));
    return {};
  });
}, 30000);

test("canonical and CloudFront pass-through never add a disallowed protocol header", () => {
  const handler = runInNewContext(`${viewerFunctionCode(hostname, [alias])}; handler`) as (
    event: unknown,
  ) => unknown;
  for (const host of [hostname, "d123example.cloudfront.net"]) {
    const request = {
      method: "GET",
      uri: "/p",
      querystring: { tag: { value: "a%2Fb" } },
      headers: { host: { value: host }, "x-forwarded-host": { value: "untrusted.invalid" } },
    };
    const result = object(handler({ request }));
    const headers = object(result.headers);
    expect(headers["x-forwarded-proto"]).toBeUndefined();
    expect(Object.keys(headers).sort()).toEqual(["host", "x-forwarded-host"]);
    expect(headers.host).toEqual({ value: host });
    expect(headers["x-forwarded-host"]).toEqual({ value: hostname });
    expect(result.uri).toBe("/p");
    expect(result.querystring).toEqual({ tag: { value: "a%2Fb" } });
  }
});

test("host rejection, encoded repeated-query redirects and alias mutation rejection remain", () => {
  const handler = runInNewContext(`${viewerFunctionCode(hostname, [alias])}; handler`) as (
    event: unknown,
  ) => unknown;
  const request = {
    method: "GET",
    uri: "/p",
    headers: { host: { value: alias } },
    querystring: {
      tag: { multiValue: [{ value: "a%2Fb" }, { value: "two+words" }] },
      empty: { value: "" },
    },
  };
  expect(handler({ request })).toMatchObject({
    statusCode: 308,
    headers: { location: { value: `https://${hostname}/p?tag=a%2Fb&tag=two+words&empty=` } },
  });
  expect(handler({ request: { ...request, method: "POST" } })).toMatchObject({ statusCode: 421 });
  expect(
    handler({ request: { ...request, headers: { host: { value: "unknown.invalid" } } } }),
  ).toMatchObject({ statusCode: 403 });
});

test("S3 OAC origin omits the provider-normalized empty OAI block without broadening access", () => {
  const distribution = inputs("aws:cloudfront/distribution:Distribution");
  const origins = array(distribution.origins);
  const assetOrigin = origins.find((origin) => origin.originId === "assets");
  if (!assetOrigin) throw new Error("Missing S3 origin");
  expect(assetOrigin.s3OriginConfig).toBeUndefined();
  expect(assetOrigin).toMatchObject({
    domainName: "test.s3.eu-west-1.amazonaws.com",
    originPath: "/client",
    originAccessControlId: "tap-prod-website-s3-oac-id",
  });
  expect(assetOrigin.customOriginConfig).toBeUndefined();
  const policy = object(
    JSON.parse(z.string().parse(inputs("aws:s3/bucketPolicy:BucketPolicy").policy)),
  );
  const statements = array(policy.Statement);
  expect(statements).toHaveLength(2);
  expect(statements.find((statement) => statement.Effect === "Deny")).toMatchObject({
    Condition: { Bool: { "aws:SecureTransport": "false" } },
  });
  expect(statements.find((statement) => statement.Effect === "Allow")).toMatchObject({
    Principal: { Service: "cloudfront.amazonaws.com" },
    Action: "s3:GetObject",
    Condition: {
      StringEquals: { "AWS:SourceArn": "arn:aws:mock::123456789012:tap-prod-website-distribution" },
    },
  });
  expect(statements.find((statement) => statement.Effect === "Allow")?.Resource).toMatch(
    /\/client\/\*$/,
  );
});

test("private streaming, HTTPS and original release/concurrency choices remain", () => {
  const distribution = inputs("aws:cloudfront/distribution:Distribution");
  const ssr = array(distribution.origins).find((origin) => origin.originId === "ssr");
  expect(ssr).toMatchObject({
    originAccessControlId: "tap-prod-website-lambda-oac-id",
    customOriginConfig: { originProtocolPolicy: "https-only", originSslProtocols: ["TLSv1.2"] },
  });
  expect(object(distribution.defaultCacheBehavior)).toMatchObject({
    viewerProtocolPolicy: "redirect-to-https",
    compress: false,
  });
  expect(distribution.waitForDeployment).toBe(false);
  expect(inputs("aws:lambda/functionUrl:FunctionUrl")).toMatchObject({
    authorizationType: "AWS_IAM",
    invokeMode: "RESPONSE_STREAM",
    qualifier: "live",
  });
  expect(inputs("aws:lambda/function:Function")).toMatchObject({
    runtime: "nodejs22.x",
    publish: true,
    reservedConcurrentExecutions: 2,
  });
  const permissions = records.filter(
    (record) => record.type === "aws:lambda/permission:Permission",
  );
  expect(permissions.map((record) => record.inputs.action).sort()).toEqual([
    "lambda:InvokeFunction",
    "lambda:InvokeFunctionUrl",
  ]);
  for (const permission of permissions)
    expect(permission.inputs).toMatchObject({
      principal: "cloudfront.amazonaws.com",
      qualifier: "live",
      sourceArn: "arn:aws:mock::123456789012:tap-prod-website-distribution",
    });
  for (const oac of records.filter(
    (record) => record.type === "aws:cloudfront/originAccessControl:OriginAccessControl",
  ))
    expect(oac.inputs).toMatchObject({ signingBehavior: "always", signingProtocol: "sigv4" });
});

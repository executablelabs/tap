import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import * as pulumi from "@pulumi/pulumi";
import { z } from "zod";
import { createRelease, lambdaZip } from "../../scripts/release";
import { validateSettings } from "../src/config";
import { createInfrastructure } from "../src/infrastructure";
import { viewerFunctionCode } from "../src/viewer";

const base = {
  environment: "dev",
  phase: "foundation",
  accountId: "123456789012",
  region: "eu-west-1",
  hostname: "tap.test.invalid",
  redirectHosts: ["www.tap.test.invalid"],
  certificateArn:
    "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
  monthlyBudgetUsd: 20,
  approvalReference: "TEST-APPROVAL",
  memoryMiB: 256,
  reservedConcurrency: 2,
  routing: "manual",
  adoption: "create-only",
};
const dev = { project: "tap-infrastructure", stack: "tap-dev-website" };
const prod = { ...dev, stack: "tap-prod-website" };
const directory = mkdtempSync(join(tmpdir(), "tap-website-infra-"));
const client = join(directory, "client");
mkdirSync(client);
writeFileSync(join(client, "styles.css"), "body{color:black}");
const lambda = join(directory, "lambda.mjs");
writeFileSync(lambda, "export const handler=()=>{};");
const artifact = join(directory, "release");
const manifest = createRelease("tap", prod.stack, client, lambda, artifact);
const approved = {
  ...base,
  environment: "prod",
  phase: "release",
  releaseDirectory: artifact,
  assetsVerifiedReleaseId: manifest.releaseId,
};
const object = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
const array = (value: unknown) => z.array(z.record(z.string(), z.unknown())).parse(value);
const records: {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
  provider: string | undefined;
}[] = [];
const registrations: {
  type: string;
  options: pulumi.ResourceOptions;
  resource: pulumi.Resource;
}[] = [];
const entries = (type: string) => records.filter((entry) => entry.type === type);
const resolveOutput = <T>(output: pulumi.Output<T>): Promise<T> =>
  new Promise((resolve) => {
    output.apply((value) => {
      resolve(value);
      return value;
    });
  });
beforeAll(async () => {
  await pulumi.runtime.setMocks(
    {
      newResource(args) {
        const inputs = object(args.inputs);
        records.push({ type: args.type, name: args.name, inputs, provider: args.provider });
        return {
          id: `${args.name}-id`,
          state: {
            ...inputs,
            arn: `arn:aws:mock::123456789012:${args.name}`,
            version: "1",
            functionUrl: "https://unit.lambda-url.eu-west-1.on.aws/",
            domainName: "unit.cloudfront.net",
            bucketRegionalDomainName: "unit.s3.eu-west-1.amazonaws.com",
          },
        };
      },
      call(args) {
        throw new Error(`Provider lookup prohibited: ${args.token}`);
      },
    },
    dev.project,
    dev.stack,
    false,
  );
  await pulumi.runtime.runInPulumiStack(async () => {
    pulumi.runtime.registerStackTransformation((args) => {
      registrations.push({ type: args.type, options: args.opts, resource: args.resource });
      return undefined;
    });
    createInfrastructure(base, dev);
    const website = createInfrastructure(approved, prod);
    await Promise.all(registrations.map((entry) => resolveOutput(entry.resource.urn)));
    return { endpoint: website.endpoint };
  });
}, 30000);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("app/stack/account/regions are explicit; foundation contains storage only", () => {
  expect(entries("pulumi:providers:aws").map((entry) => entry.inputs.region)).toEqual([
    "eu-west-1",
    "us-east-1",
    "eu-west-1",
    "us-east-1",
  ]);
  for (const provider of entries("pulumi:providers:aws"))
    expect(JSON.parse(z.string().parse(provider.inputs.allowedAccountIds))).toEqual([
      base.accountId,
    ]);
  for (const entry of records.filter((entry) => entry.type.startsWith("aws:"))) {
    expect(entry.name).toMatch(/^tap-(dev|prod)-website-/);
    expect(entry.provider).toContain(
      entry.name.startsWith("tap-dev") ? "tap-dev-website" : "tap-prod-website",
    );
    if (entry.name.startsWith("tap-dev")) expect(entry.type.startsWith("aws:s3/")).toBe(true);
  }
  expect(
    records.some((entry) =>
      /ec2|ecs|ebs|backup|railway|route53|cloudformation|kubernetes/.test(entry.type),
    ),
  ).toBe(false);
});
test("private versioned encrypted retained assets; distribution-scoped OAC, no public bucket policy", () => {
  for (const bucket of entries("aws:s3/bucketV2:BucketV2"))
    expect(bucket.inputs.forceDestroy).toBe(false);
  for (const entry of entries("aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock"))
    expect(entry.inputs).toMatchObject({
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    });
  for (const entry of entries("aws:s3/bucketVersioningV2:BucketVersioningV2"))
    expect(object(entry.inputs.versioningConfiguration).status).toBe("Enabled");
  for (const entry of entries(
    "aws:s3/bucketServerSideEncryptionConfigurationV2:BucketServerSideEncryptionConfigurationV2",
  ))
    expect(array(entry.inputs.rules)[0]?.applyServerSideEncryptionByDefault).toEqual({
      sseAlgorithm: "AES256",
    });
  for (const entry of entries("aws:s3/bucketPolicy:BucketPolicy")) {
    const statements = array(object(JSON.parse(z.string().parse(entry.inputs.policy))).Statement);
    expect(statements[0]).toMatchObject({
      Effect: "Deny",
      Condition: { Bool: { "aws:SecureTransport": "false" } },
    });
    for (const allow of statements.filter((statement) => statement.Effect === "Allow"))
      expect(allow).toMatchObject({
        Principal: { Service: "cloudfront.amazonaws.com" },
        Action: "s3:GetObject",
        Condition: {
          StringEquals: {
            "AWS:SourceArn": "arn:aws:mock::123456789012:tap-prod-website-distribution",
          },
        },
      });
  }
  expect(
    entries("aws:cloudfront/originAccessControl:OriginAccessControl").map(
      (entry) => entry.inputs.originAccessControlOriginType,
    ),
  ).toEqual(["s3", "lambda"]);
  for (const entry of entries("aws:cloudfront/originAccessControl:OriginAccessControl"))
    expect(entry.inputs.signingBehavior).toBe("always");
  for (const registration of registrations.filter((entry) => entry.type.startsWith("aws:"))) {
    expect(registration.options.protect).toBe(true);
    if (/aws:(s3\/|cloudwatch\/logGroup|lambda\/function:)/.test(registration.type))
      expect(registration.options.retainOnDelete).toBe(true);
  }
});
test("regional published Lambda alias streams privately; only this distribution can invoke", () => {
  expect(entries("aws:lambda/function:Function")).toHaveLength(1);
  const func = entries("aws:lambda/function:Function")[0];
  expect(func?.inputs).toMatchObject({
    runtime: "nodejs22.x",
    handler: "lambda.handler",
    publish: true,
    reservedConcurrentExecutions: 2,
  });
  expect(func?.inputs.vpcConfig).toBeUndefined();
  expect(func?.inputs.layers).toBeUndefined();
  expect(entries("aws:lambda/functionUrl:FunctionUrl")[0]?.inputs).toMatchObject({
    authorizationType: "AWS_IAM",
    invokeMode: "RESPONSE_STREAM",
    qualifier: "live",
  });
  expect(entries("aws:lambda/alias:Alias")[0]?.inputs.functionVersion).toBe("1");
  expect(
    entries("aws:lambda/permission:Permission")
      .map((entry) => entry.inputs.action)
      .sort(),
  ).toEqual(["lambda:InvokeFunction", "lambda:InvokeFunctionUrl"]);
  for (const entry of entries("aws:lambda/permission:Permission"))
    expect(entry.inputs).toMatchObject({
      principal: "cloudfront.amazonaws.com",
      qualifier: "live",
      sourceArn: "arn:aws:mock::123456789012:tap-prod-website-distribution",
    });
});
test("SSR never uses S3 fallback or cached HTML, static behaviors use S3, errors are not cached", () => {
  const distribution = entries("aws:cloudfront/distribution:Distribution")[0];
  expect(distribution).toBeDefined();
  const inputs = object(distribution?.inputs);
  expect(object(inputs.defaultCacheBehavior).targetOriginId).toBe("ssr");
  expect(inputs.originGroups).toBeUndefined();
  expect(inputs.defaultRootObject).toBeUndefined();
  expect(
    array(inputs.orderedCacheBehaviors).map((entry) => [entry.pathPattern, entry.targetOriginId]),
  ).toEqual([
    ["assets/*", "assets"],
    ["styles.css", "assets"],
  ]);
  const noCache = entries("aws:cloudfront/cachePolicy:CachePolicy").find((entry) =>
    entry.name.endsWith("no-cache"),
  );
  expect(noCache?.inputs).toMatchObject({ minTtl: 0, defaultTtl: 0, maxTtl: 0 });
  const policy = entries("aws:cloudfront/originRequestPolicy:OriginRequestPolicy")[0];
  expect(policy?.inputs).toMatchObject({
    cookiesConfig: { cookieBehavior: "all" },
    queryStringsConfig: { queryStringBehavior: "all" },
    headersConfig: { headerBehavior: "allExcept", headers: { items: ["host"] } },
  });
  for (const error of array(inputs.customErrorResponses)) {
    expect(error.errorCachingMinTtl).toBe(0);
    expect(error.responsePagePath).toBeUndefined();
  }
});
test("small viewer redirect preserves encoded repeated queries and never redirects/replays mutations", () => {
  const code = viewerFunctionCode(base.hostname, base.redirectHosts);
  expect(Buffer.byteLength(code)).toBeLessThan(10240);
  const handler = runInNewContext(`${code}; handler`) as (event: unknown) => unknown;
  const event = {
    request: {
      method: "GET",
      uri: "/p",
      headers: { host: { value: base.redirectHosts[0] } },
      querystring: {
        tag: { multiValue: [{ value: "a%2Fb" }, { value: "two+words" }] },
        empty: { value: "" },
      },
    },
  };
  expect(handler(event)).toMatchObject({
    statusCode: 308,
    headers: { location: { value: "https://tap.test.invalid/p?tag=a%2Fb&tag=two+words&empty=" } },
  });
  expect(handler({ request: { ...event.request, method: "POST" } })).toMatchObject({
    statusCode: 421,
  });
});
test("invalid ownership/config/artifacts fail before registration; deterministic release excludes private files", () => {
  const before = registrations.length;
  for (const input of [
    undefined,
    {},
    { ...base, capacity: "warm" },
    { ...base, monthlyBudgetUsd: 0 },
    { ...base, certificateArn: base.certificateArn.replace("us-east-1", "eu-west-1") },
    { ...base, phase: "release" },
    { ...approved, assetsVerifiedReleaseId: "b".repeat(64) },
  ])
    expect(() => createInfrastructure(input, dev)).toThrow();
  expect(() => createInfrastructure(base, { ...dev, stack: "tap-prod-website" })).toThrow(
    "INFRA_STACK_ISOLATION",
  );
  writeFileSync(join(artifact, "client/styles.css"), "tampered");
  expect(() => createInfrastructure(approved, prod)).toThrow("INFRA_ASSET_CHECKSUM");
  expect(registrations.length).toBe(before);
  expect(lambdaZip(Buffer.from("test"))).toEqual(lambdaZip(Buffer.from("test")));
  writeFileSync(join(client, ".env"), "not-public");
  expect(() =>
    createRelease("tap", prod.stack, client, lambda, join(directory, "rejected")),
  ).toThrow();
  expect(validateSettings(base, dev).prefix).toBe(dev.stack);
});

import { beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as pulumi from "@pulumi/pulumi";
import { z } from "zod";
import { createRelease } from "../../scripts/release";
import { createInfrastructure } from "../src/infrastructure";

const records: { type: string; inputs: Record<string, unknown> }[] = [];
const registrations: {
  type: string;
  options: pulumi.ResourceOptions;
  resource: pulumi.Resource;
}[] = [];
const resolveOutput = <T>(output: pulumi.Output<T>): Promise<T> =>
  new Promise((resolve) => {
    output.apply((value) => {
      resolve(value);
      return value;
    });
  });
const inputs = (type: string) => {
  const found = records.find((record) => record.type === type);
  if (!found) throw new Error(`Missing mocked resource: ${type}`);
  return found.inputs;
};
beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), "tap-release-boundary-"));
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
        const value = z.record(z.string(), z.unknown()).parse(args.inputs);
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
      registrations.push({ type: args.type, options: args.opts, resource: args.resource });
      return undefined;
    });
    createInfrastructure(
      {
        environment: "prod",
        phase: "release",
        accountId: "123456789012",
        region: "eu-west-1",
        hostname: "tap.test.invalid",
        redirectHosts: [],
        certificateArn:
          "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
        monthlyBudgetUsd: 5,
        approvalReference: "TEST-RELEASE-BOUNDARY",
        memoryMiB: 256,
        reservedConcurrency: 2,
        routing: "manual",
        adoption: "create-only",
        releaseDirectory,
        assetsVerifiedReleaseId: manifest.releaseId,
      },
      { project: "tap-infrastructure", stack: "tap-prod-website" },
    );
    await Promise.all(registrations.map((record) => resolveOutput(record.resource.urn)));
    return {};
  });
}, 30000);

test("CloudFront create does not wait past the command deadline; protection remains", () => {
  const distribution = inputs("aws:cloudfront/distribution:Distribution");
  expect(distribution.waitForDeployment).toBe(false);
  expect(distribution.enabled).toBe(true);
  expect(distribution.retainOnDelete).toBe(true);
  expect(
    registrations.find((record) => record.type === "aws:cloudfront/distribution:Distribution")
      ?.options.protect,
  ).toBe(true);
});
test("client namespace, private streaming origins and concurrency remain unchanged", () => {
  const distribution = inputs("aws:cloudfront/distribution:Distribution");
  const origins = z.array(z.record(z.string(), z.unknown())).parse(distribution.origins);
  expect(origins).toHaveLength(2);
  expect(origins.find((origin) => origin.originId === "assets")?.originPath).toBe("/client");
  const policy = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(z.string().parse(inputs("aws:s3/bucketPolicy:BucketPolicy").policy)));
  const statements = z.array(z.record(z.string(), z.unknown())).parse(policy.Statement);
  expect(statements.find((statement) => statement.Effect === "Allow")?.Resource).toMatch(
    /\/client\/\*$/,
  );
  expect(inputs("aws:lambda/functionUrl:FunctionUrl")).toMatchObject({
    authorizationType: "AWS_IAM",
    invokeMode: "RESPONSE_STREAM",
  });
  expect(inputs("aws:lambda/function:Function")).toMatchObject({
    runtime: "nodejs22.x",
    reservedConcurrentExecutions: 2,
    publish: true,
  });
  expect(inputs("aws:cloudwatch/logGroup:LogGroup").retentionInDays).toBe(14);
  expect(
    records
      .filter((record) => record.type === "aws:lambda/permission:Permission")
      .map((record) => record.inputs.action)
      .sort(),
  ).toEqual(["lambda:InvokeFunction", "lambda:InvokeFunctionUrl"]);
  expect(records.some((record) => /aws:(kms|route53|ec2|ecs)\//.test(record.type))).toBe(false);
});

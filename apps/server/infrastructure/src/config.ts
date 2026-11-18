import { isAbsolute } from "node:path";
import { z } from "zod";

export type Identity = { project: string; stack: string };
const hostname = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/);
const common = {
  environment: z.enum(["dev", "prod"]),
  accountId: z
    .string()
    .regex(/^\d{12}$/)
    .refine((s) => !/^0+$/.test(s)),
  region: z.enum(["us-east-1", "eu-west-1"]),
  hostname,
  redirectHosts: z.array(hostname).max(3),
  certificateArn: z.string(),
  monthlyBudgetUsd: z.number().finite().positive(),
  approvalReference: z
    .string()
    .min(8)
    .max(120)
    .regex(/^[a-zA-Z0-9/_.:-]+$/),
  memoryMiB: z
    .number()
    .int()
    .min(128)
    .max(2048)
    .refine((n) => n % 64 === 0),
  reservedConcurrency: z.number().int().min(1).max(20),
  routing: z.literal("manual"),
  adoption: z.literal("create-only"),
};
const schema = z.discriminatedUnion("phase", [
  z.strictObject({ ...common, phase: z.literal("foundation") }),
  z.strictObject({
    ...common,
    phase: z.literal("release"),
    releaseDirectory: z.string().refine(isAbsolute),
    assetsVerifiedReleaseId: z.string().regex(/^[a-f0-9]{64}$/),
  }),
]);

export function validateSettings(raw: unknown, identity: Identity) {
  const settings = schema.parse(raw);
  const prefix = `tap-${settings.environment}-website`;
  if (identity.project !== "tap-infrastructure" || identity.stack !== prefix)
    throw new Error("INFRA_STACK_ISOLATION");
  if (/replace|example|eventpass|rickshare|gitaugakwa/i.test(JSON.stringify(settings)))
    throw new Error("INFRA_OWNERSHIP_OR_PLACEHOLDER");
  if (
    new Set([settings.hostname, ...settings.redirectHosts]).size !==
    settings.redirectHosts.length + 1
  )
    throw new Error("INFRA_DUPLICATE_HOST");
  const certificate = new RegExp(
    `^arn:aws:acm:us-east-1:${settings.accountId}:certificate/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`,
  );
  if (!certificate.test(settings.certificateArn))
    throw new Error("INFRA_CERTIFICATE_MUST_BE_SAME_ACCOUNT_US_EAST_1");
  return { ...settings, prefix };
}

import * as pulumi from "@pulumi/pulumi";
import { createInfrastructure } from "./infrastructure";

const infrastructure = createInfrastructure(
  new pulumi.Config().requireObject<unknown>("settings"),
  {
    project: pulumi.getProject(),
    stack: pulumi.getStack(),
  },
);
export const proposedEndpoint = infrastructure.endpoint;
export const proposedTargetZoneId = infrastructure.distribution?.hostedZoneId;
export const approvedHostname = infrastructure.settings.hostname;
export const routing = "manual; no DNS records or automatic cross-origin retry";
export const assetBucket = infrastructure.bucket.id;
export const phase = infrastructure.settings.phase;
export const releaseId = infrastructure.releaseId;
export const publishedAlias = infrastructure.alias?.arn;

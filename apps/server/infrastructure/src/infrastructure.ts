import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { type Identity, validateSettings } from "./config";
import { readRelease } from "./release";
import { viewerFunctionCode } from "./viewer";

export const retention = { protect: true, retainOnDelete: true } as const;
export function createInfrastructure(raw: unknown, identity: Identity) {
  const settings = validateSettings(raw, identity);
  // Verify all artifact bytes/ownership before even registering a provider.
  const release =
    settings.phase === "release"
      ? readRelease(settings.releaseDirectory, settings.prefix, settings.assetsVerifiedReleaseId)
      : undefined;
  const name = settings.prefix;
  const tags = { Application: "tap", Environment: settings.environment, Stack: name };
  const regional = new aws.Provider(`${name}-regional`, {
    region: settings.region,
    allowedAccountIds: [settings.accountId],
    defaultTags: { tags },
  });
  const global = new aws.Provider(`${name}-global`, {
    region: "us-east-1",
    allowedAccountIds: [settings.accountId],
    defaultTags: { tags },
  });
  const options = { provider: regional, protect: true };
  const retained = { provider: regional, ...retention };
  const edge = { provider: global, protect: true };
  const bucket = new aws.s3.BucketV2(
    `${name}-assets`,
    { bucket: `${name}-${settings.accountId}-assets`, forceDestroy: false },
    retained,
  );
  new aws.s3.BucketVersioningV2(
    `${name}-versions`,
    { bucket: bucket.id, versioningConfiguration: { status: "Enabled" } },
    retained,
  );
  new aws.s3.BucketServerSideEncryptionConfigurationV2(
    `${name}-encryption`,
    {
      bucket: bucket.id,
      rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" } }],
    },
    retained,
  );
  const privateAccess = new aws.s3.BucketPublicAccessBlock(
    `${name}-private`,
    {
      bucket: bucket.id,
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    },
    retained,
  );
  new aws.s3.BucketOwnershipControls(
    `${name}-ownership`,
    { bucket: bucket.id, rule: { objectOwnership: "BucketOwnerEnforced" } },
    retained,
  );
  const denyTls = {
    Effect: "Deny",
    Principal: "*",
    Action: "s3:*",
    Resource: [bucket.arn, pulumi.interpolate`${bucket.arn}/*`],
    Condition: { Bool: { "aws:SecureTransport": "false" } },
  };
  if (!release) {
    new aws.s3.BucketPolicy(
      `${name}-asset-policy`,
      {
        bucket: bucket.id,
        policy: pulumi.jsonStringify({ Version: "2012-10-17", Statement: [denyTls] }),
      },
      { ...retained, dependsOn: privateAccess },
    );
    return {
      settings,
      bucket,
      endpoint: undefined,
      distribution: undefined,
      alias: undefined,
      releaseId: undefined,
    };
  }
  const logs = new aws.cloudwatch.LogGroup(
    `${name}-logs`,
    { name: `/aws/lambda/${name}-ssr`, retentionInDays: 14 },
    retained,
  );
  const role = new aws.iam.Role(
    `${name}-ssr-role`,
    {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
    },
    options,
  );
  const logging = new aws.iam.RolePolicy(
    `${name}-logs-policy`,
    {
      role: role.id,
      policy: pulumi.jsonStringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
            Resource: pulumi.interpolate`${logs.arn}:*`,
          },
        ],
      }),
    },
    options,
  );
  const func = new aws.lambda.Function(
    `${name}-ssr`,
    {
      name: `${name}-ssr`,
      role: role.arn,
      runtime: "nodejs22.x",
      architectures: ["x86_64"],
      handler: "lambda.handler",
      code: new pulumi.asset.FileArchive(release.zipPath),
      sourceCodeHash: Buffer.from(release.manifest.lambdaSha256, "hex").toString("base64"),
      publish: true,
      memorySize: settings.memoryMiB,
      timeout: 60,
      reservedConcurrentExecutions: settings.reservedConcurrency,
      environment: {
        variables: {
          NODE_ENV: "production",
          SITE_ORIGIN: `https://${settings.hostname}`,
          SSR_RELEASE_ID: release.manifest.releaseId,
        },
      },
    },
    { ...retained, dependsOn: [logs, logging] },
  );
  const alias = new aws.lambda.Alias(
    `${name}-live`,
    { name: "live", functionName: func.name, functionVersion: func.version },
    options,
  );
  const url = new aws.lambda.FunctionUrl(
    `${name}-url`,
    {
      functionName: func.name,
      qualifier: alias.name,
      authorizationType: "AWS_IAM",
      invokeMode: "RESPONSE_STREAM",
    },
    options,
  );
  const s3Oac = new aws.cloudfront.OriginAccessControl(
    `${name}-s3-oac`,
    {
      name: `${name}-s3`,
      originAccessControlOriginType: "s3",
      signingBehavior: "always",
      signingProtocol: "sigv4",
    },
    edge,
  );
  const lambdaOac = new aws.cloudfront.OriginAccessControl(
    `${name}-lambda-oac`,
    {
      name: `${name}-lambda`,
      originAccessControlOriginType: "lambda",
      signingBehavior: "always",
      signingProtocol: "sigv4",
    },
    edge,
  );
  const viewer = new aws.cloudfront.Function(
    `${name}-viewer`,
    {
      name: `${name}-viewer`,
      runtime: "cloudfront-js-2.0",
      publish: true,
      code: viewerFunctionCode(settings.hostname, settings.redirectHosts),
    },
    edge,
  );
  const noCache = new aws.cloudfront.CachePolicy(
    `${name}-no-cache`,
    {
      name: `${name}-no-cache`,
      minTtl: 0,
      defaultTtl: 0,
      maxTtl: 0,
      parametersInCacheKeyAndForwardedToOrigin: {
        cookiesConfig: { cookieBehavior: "none" },
        headersConfig: { headerBehavior: "none" },
        queryStringsConfig: { queryStringBehavior: "none" },
        enableAcceptEncodingBrotli: false,
        enableAcceptEncodingGzip: false,
      },
    },
    edge,
  );
  const allViewer = new aws.cloudfront.OriginRequestPolicy(
    `${name}-viewer-except-host`,
    {
      name: `${name}-viewer-except-host`,
      cookiesConfig: { cookieBehavior: "all" },
      queryStringsConfig: { queryStringBehavior: "all" },
      headersConfig: { headerBehavior: "allExcept", headers: { items: ["host"] } },
    },
    edge,
  );
  function staticCache(suffix: string, ttl: number) {
    return new aws.cloudfront.CachePolicy(
      `${name}-${suffix}`,
      {
        name: `${name}-${suffix}`,
        minTtl: 0,
        defaultTtl: ttl,
        maxTtl: ttl,
        parametersInCacheKeyAndForwardedToOrigin: {
          cookiesConfig: { cookieBehavior: "none" },
          headersConfig: { headerBehavior: "none" },
          queryStringsConfig: { queryStringBehavior: "none" },
          enableAcceptEncodingBrotli: true,
          enableAcceptEncodingGzip: true,
        },
      },
      edge,
    );
  }
  const immutable = staticCache("immutable", 31536000);
  const metadata = staticCache("metadata", 60);
  const security = {
    contentTypeOptions: { override: true },
    frameOptions: { frameOption: "DENY", override: true },
    referrerPolicy: { referrerPolicy: "strict-origin-when-cross-origin", override: true },
    strictTransportSecurity: {
      accessControlMaxAgeSec: 31536000,
      includeSubdomains: false,
      preload: false,
      override: true,
    },
  };
  const dynamicHeaders = new aws.cloudfront.ResponseHeadersPolicy(
    `${name}-dynamic-headers`,
    {
      name: `${name}-dynamic-headers`,
      securityHeadersConfig: security,
      customHeadersConfig: {
        items: [{ header: "Cache-Control", value: "private, no-store", override: true }],
      },
    },
    edge,
  );
  const staticHeaders = new aws.cloudfront.ResponseHeadersPolicy(
    `${name}-static-headers`,
    { name: `${name}-static-headers`, securityHeadersConfig: security },
    edge,
  );
  const associations = [{ eventType: "viewer-request", functionArn: viewer.arn }];
  const distribution = new aws.cloudfront.Distribution(
    `${name}-distribution`,
    {
      enabled: true,
      // Deployment readiness is checked separately from the bounded create command.
      waitForDeployment: false,
      retainOnDelete: true,
      aliases: [settings.hostname, ...settings.redirectHosts],
      httpVersion: "http2and3",
      isIpv6Enabled: true,
      priceClass: "PriceClass_100",
      origins: [
        {
          originId: "ssr",
          domainName: url.functionUrl.apply((value) => new URL(value).hostname),
          originAccessControlId: lambdaOac.id,
          connectionAttempts: 1,
          customOriginConfig: {
            httpPort: 80,
            httpsPort: 443,
            originProtocolPolicy: "https-only",
            originSslProtocols: ["TLSv1.2"],
            originReadTimeout: 60,
          },
        },
        {
          originId: "assets",
          domainName: bucket.bucketRegionalDomainName,
          originPath: "/client",
          originAccessControlId: s3Oac.id,
        },
      ],
      defaultCacheBehavior: {
        targetOriginId: "ssr",
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD"],
        viewerProtocolPolicy: "redirect-to-https",
        cachePolicyId: noCache.id,
        originRequestPolicyId: allViewer.id,
        responseHeadersPolicyId: dynamicHeaders.id,
        functionAssociations: associations,
        compress: false,
      },
      orderedCacheBehaviors: [
        {
          pathPattern: "assets/*",
          targetOriginId: "assets",
          allowedMethods: ["GET", "HEAD"],
          cachedMethods: ["GET", "HEAD"],
          viewerProtocolPolicy: "redirect-to-https",
          cachePolicyId: immutable.id,
          responseHeadersPolicyId: staticHeaders.id,
          functionAssociations: associations,
          compress: true,
        },
        {
          pathPattern: "styles.css",
          targetOriginId: "assets",
          allowedMethods: ["GET", "HEAD"],
          cachedMethods: ["GET", "HEAD"],
          viewerProtocolPolicy: "redirect-to-https",
          cachePolicyId: metadata.id,
          responseHeadersPolicyId: staticHeaders.id,
          functionAssociations: associations,
          compress: true,
        },
      ],
      customErrorResponses: [400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504].map(
        (errorCode) => ({ errorCode, errorCachingMinTtl: 0 }),
      ),
      restrictions: { geoRestriction: { restrictionType: "none" } },
      viewerCertificate: {
        acmCertificateArn: settings.certificateArn,
        sslSupportMethod: "sni-only",
        minimumProtocolVersion: "TLSv1.2_2021",
      },
    },
    edge,
  );
  new aws.s3.BucketPolicy(
    `${name}-asset-policy`,
    {
      bucket: bucket.id,
      policy: pulumi.jsonStringify({
        Version: "2012-10-17",
        Statement: [
          denyTls,
          {
            Effect: "Allow",
            Principal: { Service: "cloudfront.amazonaws.com" },
            Action: "s3:GetObject",
            Resource: pulumi.interpolate`${bucket.arn}/client/*`,
            Condition: { StringEquals: { "AWS:SourceArn": distribution.arn } },
          },
        ],
      }),
    },
    { ...retained, dependsOn: privateAccess },
  );
  new aws.lambda.Permission(
    `${name}-invoke-url`,
    {
      function: func.name,
      qualifier: alias.name,
      action: "lambda:InvokeFunctionUrl",
      principal: "cloudfront.amazonaws.com",
      sourceArn: distribution.arn,
      functionUrlAuthType: "AWS_IAM",
    },
    options,
  );
  new aws.lambda.Permission(
    `${name}-invoke`,
    {
      function: func.name,
      qualifier: alias.name,
      action: "lambda:InvokeFunction",
      principal: "cloudfront.amazonaws.com",
      sourceArn: distribution.arn,
    },
    options,
  );
  return {
    settings,
    bucket,
    distribution,
    alias,
    endpoint: distribution.domainName,
    releaseId: release.manifest.releaseId,
  };
}

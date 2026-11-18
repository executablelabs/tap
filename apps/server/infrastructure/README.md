# Tap website infrastructure

This Pulumi project defines Tap's website resources: a private, versioned S3
asset bucket, a Node 22 Lambda behind an IAM-only streaming URL, and a CloudFront
distribution with signed origin access. It does not create DNS records or
change the payment backend.

This directory holds source and an intentionally invalid example, not a
deployment. Do not initialize a new stack to adopt an existing deployment.
The operator must use the approved Tap backend, account, stack and existing
secrets provider. Stack configurations, state, credentials and recovery
material do not belong in this repository. No GitHub workflow applies this
project.

## Offline validation

From this directory, with Bun 1.4.2:

```sh
bun install --frozen-lockfile --ignore-scripts --no-env-file
bun --no-env-file --no-install node_modules/typescript/bin/tsc --noEmit
bun --no-env-file --no-install test ./tests/infrastructure.check.ts
bun --no-env-file --no-install test ./tests/cloudfront-repair.check.ts
bun --no-env-file --no-install test ./tests/release-deployment-boundary.check.ts
```

The cases use mocks and local release fixtures. Run each suite in its own
process because Pulumi mocks are process-global. These checks do not contact
AWS or establish that an apply is safe. A production operation requires a
reviewed preview, verified release assets, and the operator's release approval.

# Tap Pulumi preview handoff pilot

GitHub verifies a candidate, waits for review, and hands its immutable identifiers
to the Tap operator. This workflow does not run Pulumi, assume an AWS role,
write state, upload site assets, or deploy.

## Enable the approval gate

Before dispatching this workflow, create the `tap-website-preview` GitHub
environment with a named reviewer and a branch rule for `main` only (no tags).
Disable administrator bypass and enable prevention of self-review. Confirm that
a different authorized maintainer can dispatch when needed. After reading back
those settings, set the environment variable `TAP_WEBSITE_PREVIEW_READY` to
`required-review`. It is not a secret; the workflow otherwise fails without
producing a handoff. Remove the variable before relaxing any protection rule.
Set no environment secrets.

## Request and review a preview

1. Run **AWS website candidate** on the current `main`. Once it succeeds, use its
   run ID to dispatch **Tap Pulumi preview handoff** on the same `main` commit.
   If `main` has moved, rebuild the candidate rather than picking an older SHA.
2. The verifier checks the run's origin, success, attempt and commit, then
   matches the downloaded archive against GitHub's digest. The reviewer checks
   the source and candidate run before approving the handoff. The approved job
   records only public release identifiers in its summary.
3. The operator independently checks those identifiers, the manifest, and
   approved asset staging. Follow the existing Tap release procedure for
   preview on the existing stack and backend with the existing passphrase.
   Keep the detailed preview and state evidence private. A handoff approval is
   not apply approval; apply remains a separate manual operation.

This pilot deliberately does not add OIDC, a production executor, or new
passphrase custody. Those require a separate design and approval.

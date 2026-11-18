# Tap AWS website candidates

Once the build and workflow commits are on `main`, choose **AWS website
candidate → Run workflow** on `main` in `executablelabs/tap`. Other branches
and forks cannot produce a candidate through this workflow.

The job runs the repository checks and the built Lambda smoke tests. It then
verifies the ZIP, stylesheet and release manifest against the build. The
seven-day artifact contains only `lambda.zip`, `client/styles.css`,
`manifest.json`, and `provenance.json`. Compare the source commit, release ID,
and artifact digest with the run summary before handing it to an operator.

The job does not require AWS credentials, read Pulumi state, or deploy
anything. The run metadata identifies the build; it is not deployment
approval or a signature.

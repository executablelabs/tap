# Tap website

`bun run dev` runs the Hono website locally. `/p` only hands off to the Android
app. It does not decode or display payment details from the URL. The website
health check reports on the website origin only, not payments or ENS.

## Build the AWS artifact locally

Install the root workspace with `bun install --frozen-lockfile`. Use Bun 1.4.2
and Node 22.23.4. Then, from `apps/server`:

```sh
WEBSITE_STACK=tap-dev-website bun run build:aws
bun run test:aws
```

The build emits a self-contained Node Lambda response-streaming bundle and a
manifest with the Lambda ZIP and stylesheet hashes under `dist/release/`.
`test:aws` uses those files, so run it after the build. These commands do not
need AWS credentials and do not provision or deploy anything.

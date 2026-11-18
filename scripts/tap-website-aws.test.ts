import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lambdaZip } from "../apps/server/scripts/release";

test("built Node bundle is self-contained and streams Hono HTML, security, noindex, app links and true 404s", async () => {
  const bundle = fileURLToPath(new URL("../apps/server/dist/runtime/lambda.mjs", import.meta.url));
  const code = `
    import { registerHooks, isBuiltin } from 'node:module';
    import { Writable } from 'node:stream';
    import { pathToFileURL } from 'node:url';
    const bundle = pathToFileURL(${JSON.stringify(bundle)}).href;
    registerHooks({resolve(specifier, context, next) {
      if (specifier !== bundle && !isBuiltin(specifier)) throw new Error('Not self-contained: ' + specifier);
      return next(specifier, context);
    }});
    globalThis.awslambda = { streamifyResponse: fn => fn, HttpResponseStream: {from(stream, metadata) { stream.metadata = metadata; return stream; }} };
    const { handler } = await import(bundle);
    async function request(path, query = '', method = 'GET') {
      let body = ''; const stream = new Writable({write(chunk, encoding, done) { body += chunk.toString(); done(); }});
      await handler({version:'2.0', rawPath:path, rawQueryString:query, headers:{host:'unit.lambda-url.eu-west-1.on.aws'}, requestContext:{domainName:'unit.lambda-url.eu-west-1.on.aws',http:{method,path,protocol:'HTTP/1.1',sourceIp:'127.0.0.1'}}, isBase64Encoded:false}, stream, {callbackWaitsForEmptyEventLoop:false});
      return {...stream.metadata, body};
    }
    const root = await request('/');
    if (root.statusCode !== 200 || !root.body.includes('The cash register is already in your pocket.') || !root.headers['content-security-policy'].includes("script-src 'none'")) throw new Error('SSR/security regression');
    const handoff = await request('/p', 'merchant=%3Cscript%3Ebad%3C%2Fscript%3E&amount=9');
    if (!handoff.body.includes('name="robots" content="noindex"') || handoff.body.includes('<script>bad') || handoff.body !== (await request('/p', 'merchant=different')).body) throw new Error('Unverified payment input leaked');
    if (root.headers['cache-control'] !== 'private, no-store' || handoff.headers['cache-control'] !== 'private, no-store') throw new Error('Request-time HTML may be cached');
    const links = await request('/.well-known/assetlinks.json');
    if (!links.body.includes('xyz.tap.demo') || !links.headers['cache-control'].includes('max-age=')) throw new Error('App links changed');
    if ((await request('/missing')).statusCode !== 404 || (await request('/', '', 'HEAD')).body !== '') throw new Error('Status/HEAD regression');
    if ((await request('/health')).headers['x-health-scope'] !== 'website-origin-only') throw new Error('Ambiguous health scope');
  `;
  const child = Bun.spawn(["node", "--input-type=module", "--eval", code], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const error = await new Response(child.stderr).text();
  expect(await child.exited, error).toBe(0);
});

test("S3 CSS equals source and ZIP is deterministic with the expected handler entry", () => {
  const zip = readFileSync(new URL("../apps/server/dist/release/lambda.zip", import.meta.url));
  const code = readFileSync(new URL("../apps/server/dist/runtime/lambda.mjs", import.meta.url));
  expect(zip.equals(lambdaZip(code))).toBe(true);
  expect(zip.subarray(30, 40).toString()).toBe("lambda.mjs");
  expect(
    readFileSync(new URL("../apps/server/dist/client/styles.css", import.meta.url), "utf8"),
  ).toContain("@media (max-width:800px)");
});

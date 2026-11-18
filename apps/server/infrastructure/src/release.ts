import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { z } from "zod";
import { publicAssetPolicy, releaseIdFor, sha256 } from "../../scripts/release";

const manifestSchema = z.strictObject({
  application: z.literal("tap"),
  stack: z.string(),
  releaseId: z.string().regex(/^[a-f0-9]{64}$/),
  lambdaSha256: z.string().regex(/^[a-f0-9]{64}$/),
  assets: z
    .array(
      z.strictObject({
        key: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        contentType: z.string(),
        cacheControl: z.string(),
      }),
    )
    .min(1),
});
export function readRelease(directory: string, stack: string, verified: string) {
  const root = realpathSync(directory);
  function file(name: string) {
    const path = join(root, name);
    const info = lstatSync(path);
    const actual = realpathSync(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      !actual.startsWith(root + sep) ||
      info.size > 41 * 1024 * 1024
    )
      throw new Error("INFRA_UNSAFE_ARTIFACT");
    return readFileSync(path);
  }
  const manifest = manifestSchema.parse(JSON.parse(file("manifest.json").toString("utf8")));
  const { releaseId, ...identity } = manifest;
  if (manifest.stack !== stack || releaseIdFor(identity) !== releaseId || releaseId !== verified)
    throw new Error("INFRA_RELEASE_ISOLATION_OR_UNVERIFIED_ASSETS");
  const zip = file("lambda.zip");
  if (sha256(zip) !== manifest.lambdaSha256 || zip.readUInt32LE(0) !== 0x04034b50)
    throw new Error("INFRA_LAMBDA_CHECKSUM");
  const keys = new Set<string>();
  for (const asset of manifest.assets) {
    const policy = publicAssetPolicy(asset.key);
    if (
      keys.has(asset.key) ||
      asset.contentType !== policy.contentType ||
      asset.cacheControl !== policy.cacheControl ||
      sha256(file(`client/${asset.key}`)) !== asset.sha256
    )
      throw new Error("INFRA_ASSET_CHECKSUM_OR_POLICY");
    keys.add(asset.key);
  }
  return { manifest, zipPath: join(root, "lambda.zip") };
}

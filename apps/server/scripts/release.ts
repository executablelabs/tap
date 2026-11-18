import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export type Asset = { key: string; sha256: string; contentType: string; cacheControl: string };
export type Manifest = {
  application: string;
  stack: string;
  releaseId: string;
  lambdaSha256: string;
  assets: Asset[];
};
export function releaseIdFor(value: Omit<Manifest, "releaseId">) {
  return sha256(JSON.stringify(value));
}

export function publicAssetPolicy(key: string): Pick<Asset, "contentType" | "cacheControl"> {
  if (
    !/^(?:assets\/[A-Za-z0-9_./-]+|styles\.css|brand\/[A-Za-z0-9_.-]+)$/.test(key) ||
    key.split("/").some((part) => !part || part.startsWith(".")) ||
    key.endsWith(".map")
  )
    throw new Error(`Not an allowed public asset: ${key}`);
  const types: Record<string, string> = {
    js: "text/javascript",
    css: "text/css",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    avif: "image/avif",
    ico: "image/x-icon",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  const extension = key.split(".").at(-1) ?? "";
  const contentType = types[extension];
  if (!contentType) throw new Error(`Forbidden public file type: ${key}`);
  const immutable = key.startsWith("assets/") && /[-.][A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(key);
  if (key.startsWith("assets/") && !immutable)
    throw new Error(`Asset lacks immutable build hash: ${key}`);
  return {
    contentType,
    cacheControl: immutable ? "public, max-age=31536000, immutable" : "public, max-age=60",
  };
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// One stored entry, fixed DOS timestamp, no filesystem paths/permissions: reproducible bytes.
export function lambdaZip(code: Uint8Array): Buffer {
  if (!code.length || code.length > 40 * 1024 * 1024)
    throw new Error("Lambda artifact must be 1 byte..40 MiB");
  const name = Buffer.from("lambda.mjs");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(33, 12);
  local.writeUInt32LE(crc32(code), 14);
  local.writeUInt32LE(code.length, 18);
  local.writeUInt32LE(code.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(33, 14);
  central.writeUInt32LE(crc32(code), 16);
  central.writeUInt32LE(code.length, 20);
  central.writeUInt32LE(code.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + code.length, 16);
  return Buffer.concat([local, name, code, central, name, end]);
}

export function createRelease(
  application: string,
  stack: string,
  client: string,
  lambda: string,
  output: string,
): Manifest {
  if (!/^(tap|rickshare)-(dev|prod)-website$/.test(stack) || !stack.startsWith(`${application}-`))
    throw new Error("Wrong release stack");
  const assets: Asset[] = [];
  function visit(directory: string, prefix = "") {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      const key = prefix + entry;
      const info = lstatSync(path);
      if (info.isSymbolicLink()) throw new Error("Release inputs cannot contain symlinks");
      if (info.isDirectory()) {
        visit(path, `${key}/`);
        continue;
      }
      if (!info.isFile()) throw new Error("Non-file in release");
      const policy = publicAssetPolicy(key);
      assets.push({ key, sha256: sha256(readFileSync(path)), ...policy });
      mkdirSync(join(output, "client", prefix), { recursive: true });
      copyFileSync(path, join(output, "client", key));
    }
  }
  mkdirSync(output, { recursive: true });
  visit(client);
  if (!assets.length) throw new Error("Empty client artifact");
  if (!lstatSync(lambda).isFile() || lstatSync(lambda).isSymbolicLink())
    throw new Error("Unsafe Lambda input");
  const archive = lambdaZip(readFileSync(lambda));
  const identity = { application, stack, lambdaSha256: sha256(archive), assets };
  const manifest = { ...identity, releaseId: releaseIdFor(identity) };
  writeFileSync(join(output, "lambda.zip"), archive);
  writeFileSync(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

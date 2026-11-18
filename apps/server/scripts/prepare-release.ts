import { fileURLToPath } from "node:url";
import { createRelease } from "./release";

createRelease(
  "tap",
  process.env.WEBSITE_STACK ?? "tap-dev-website",
  fileURLToPath(new URL("../dist/client", import.meta.url)),
  fileURLToPath(new URL("../dist/runtime/lambda.mjs", import.meta.url)),
  fileURLToPath(new URL("../dist/release", import.meta.url)),
);

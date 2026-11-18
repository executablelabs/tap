import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { lambda: "src/lambda.ts" },
  outDir: "dist/runtime",
  format: "esm",
  platform: "node",
  target: "node22",
  fixedExtension: true,
  dts: false,
  sourcemap: false,
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  deps: { alwaysBundle: [/.*/], onlyBundle: false, onlyImport: [] },
  outputOptions: { codeSplitting: false },
});

import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/travala/travala.test.ts",
    "src/travala/live-adapter.test.ts",
    "src/sandbox-receipt.test.ts",
    "src/tools/x402-fetch.test.ts",
    "src/tools/guards.test.ts",
    "src/tools/delegation-selfheal.test.ts",
  ],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist-test",
  splitting: false,
  sourcemap: false,
  clean: true,
  external: ["@modelcontextprotocol/sdk", "ethers", "zod"],
});

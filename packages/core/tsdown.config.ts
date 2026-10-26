import { defineConfig, type UserConfig } from "tsdown";

const config: UserConfig = defineConfig({
  entry: { index: "src/index.ts", "testing/index": "src/testing/index.ts" },
  format: "esm",
  platform: "neutral",
  target: "es2025",
  dts: true,
  clean: true,
});

export default config;

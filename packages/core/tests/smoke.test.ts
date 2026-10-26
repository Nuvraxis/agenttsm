import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };

const entries = [
  {
    subpath: ".",
    source: "./src/index.ts",
    exports: ["AgentTsmError", "MemoryStore", "defineMachine"],
  },
  { subpath: "./testing", source: "./src/testing/index.ts", exports: ["FakeLLM", "fakeTools"] },
] as const;

describe("package entry points", () => {
  it.each(entries)("$subpath maps source, types and default", ({ subpath, source }) => {
    const target = pkg.exports[subpath];
    expect(Object.keys(target)).toEqual(["@nuvraxis-org/source", "types", "default"]);
    expect(target["@nuvraxis-org/source"]).toBe(source);
    expect(target.types).toMatch(/^\.\/dist\/.+\.d\.ts$/);
    expect(target.default).toBe(target.types.replace(/\.d\.ts$/, ".js"));
  });

  it.each(entries)("$subpath exposes its runtime API", async ({ source, exports }) => {
    const mod: object = await import(`.${source}`);
    expect(Object.keys(mod).sort()).toEqual([...exports]);
  });
});

describe("package metadata", () => {
  it("has no runtime dependencies", () => {
    expect(pkg).not.toHaveProperty("dependencies");
    expect(pkg).not.toHaveProperty("peerDependencies");
    expect(pkg).not.toHaveProperty("optionalDependencies");
  });
});

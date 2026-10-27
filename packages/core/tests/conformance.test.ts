import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/index.ts";
import { describeConformance, scenarios } from "./conformance.ts";

describe("conformance suite", () => {
  it("covers every runtime rule", () => {
    const covered = new Set(scenarios.flatMap((s) => s.rules));
    expect([...covered].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
  });
});

describeConformance("MemoryStore", () => new MemoryStore());

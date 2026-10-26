import { describe, expect, it } from "vitest";
import { FakeLLM, fakeTools } from "../src/testing/index.ts";

describe("FakeLLM", () => {
  it("plays scripted answers in order and records calls", async () => {
    const llm = new FakeLLM([
      "plain",
      { text: "metered", tokens: 3, costUsd: 0.1 },
      (request) => `echo ${request.prompt}`,
      () => ({ text: "fn object" }),
      new Error("rate limited"),
    ]);
    expect(await llm.complete({ prompt: "1" })).toEqual({ text: "plain" });
    expect(await llm.complete({ prompt: "2" })).toEqual({
      text: "metered",
      tokens: 3,
      costUsd: 0.1,
    });
    expect(await llm.complete({ prompt: "3" })).toEqual({ text: "echo 3" });
    expect(await llm.complete({ prompt: "4" })).toEqual({ text: "fn object" });
    await expect(llm.complete({ prompt: "5" })).rejects.toThrow("rate limited");
    await expect(llm.complete({ prompt: "6" })).rejects.toThrow("no scripted answer for call 6");
    expect(llm.calls.map((c) => c.prompt)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });
});

describe("fakeTools", () => {
  it("returns scripted values and errors per tool and records arguments", async () => {
    const tools = fakeTools({
      search: [{ value: ["a"] }, { error: "flaky" }, { value: "slow", delayMs: 5 }],
      empty: [],
    });
    expect(await tools.search("q1")).toEqual(["a"]);
    await expect(tools.search("q2")).rejects.toThrow("flaky");
    expect(await tools.search("q3")).toBe("slow");
    await expect(tools.empty()).rejects.toThrow(
      'fake tool "empty" has no scripted result for call 1',
    );
    expect(tools.search.calls).toEqual([["q1"], ["q2"], ["q3"]]);
  });
});

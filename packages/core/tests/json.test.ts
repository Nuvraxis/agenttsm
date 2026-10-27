import { describe, expect, it } from "vitest";
import { AgentTsmError, defineMachine } from "../src/index.ts";
import { parseJsonOutput } from "../src/json.ts";
import { FakeLLM } from "../src/testing/index.ts";

type Order = { id: string; qty: number };

function order(value: unknown): Order {
  const { id, qty } = (value ?? {}) as Partial<Order>;
  if (typeof id !== "string" || typeof qty !== "number") throw new Error("not an order");
  return { id, qty };
}

describe("parseJsonOutput", () => {
  it.each([
    { name: "plain JSON", text: '{"id":"A","qty":1}' },
    { name: "surrounding whitespace", text: '\n  {"id":"A","qty":1}  \n' },
    { name: "a json fence", text: '```json\n{"id":"A","qty":1}\n```' },
    { name: "a bare fence", text: '```\n{"id":"A","qty":1}```' },
  ])("accepts $name", ({ text }) => {
    expect(parseJsonOutput(text, order)).toEqual({ id: "A", qty: 1 });
  });

  it.each([
    { name: "a fence with another language", text: '```ts\n{"id":"A","qty":1}\n```' },
    { name: "an unclosed fence", text: '```json\n{"id":"A","qty":1}' },
    { name: "a fence on one line", text: '```{"id":"A","qty":1}```' },
    { name: "an empty fence", text: "```json\n```" },
  ])("does not unwrap $name", ({ text }) => {
    expect(() => parseJsonOutput(text, order)).toThrow("LLM output is not JSON");
  });

  it("handles long adversarial output in linear time", () => {
    const text = `\`\`\`${"\n".repeat(200_000)}x`;
    const started = performance.now();
    expect(() => parseJsonOutput(text, order)).toThrow(AgentTsmError);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("rejects text that is not JSON, with a shortened preview and the cause", () => {
    const text = `Sure! ${"x".repeat(300)}`;
    let error = new AgentTsmError("definition", "did not throw");
    try {
      parseJsonOutput(text, order);
    } catch (caught) {
      error = caught as AgentTsmError;
    }
    expect(error).toBeInstanceOf(AgentTsmError);
    expect(error.code).toBe("invalid_output");
    expect(error.message).toMatch(/^LLM output is not JSON: Sure! x+…$/);
    expect(error.message.length).toBeLessThan(260);
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it.each([
    { name: "an Error", thrown: new Error("not an order"), message: "not an order" },
    { name: "a string", thrown: "nope", message: "nope" },
  ])("wraps $name thrown by parse", ({ thrown, message }) => {
    const parse = () => {
      throw thrown;
    };
    expect(() => parseJsonOutput("{}", parse)).toThrow(
      new AgentTsmError("invalid_output", `LLM output failed validation: ${message}`),
    );
  });
});

describe("step.llm.completeJson", () => {
  it("returns the parsed value, passes the request on and meters usage", async () => {
    const llm = new FakeLLM([{ text: '{"id":"A","qty":2}', tokens: 9, costUsd: 0.5 }]);
    const m = defineMachine({
      initial: "extract",
      llm,
      states: {
        extract: {
          run: async (ctx: { order?: Order }, step) => {
            ctx.order = await step.llm.completeJson({ prompt: "p", system: "s", parse: order });
            return { done: true };
          },
        },
      },
    });
    const snap = await m.start({});
    expect(snap).toMatchObject({
      status: "done",
      ctx: { order: { id: "A", qty: 2 } },
      usage: { tokens: 9, costUsd: 0.5 },
    });
    expect(llm.calls).toEqual([{ prompt: "p", system: "s", signal: expect.any(AbortSignal) }]);
  });

  it("retries invalid output under maxRetries", async () => {
    const m = defineMachine({
      initial: "extract",
      retry: { baseMs: 0, maxMs: 0 },
      llm: new FakeLLM(["no", '{"id":"A","qty":3}']),
      states: {
        extract: {
          maxRetries: 1,
          run: async (ctx: { order?: Order }, step) => {
            ctx.order = await step.llm.completeJson({ prompt: "p", parse: order });
            return { done: true };
          },
        },
      },
    });
    const snap = await m.start({});
    expect(snap).toMatchObject({ status: "done", ctx: { order: { qty: 3 } } });
    const retries = (await m.trace(snap.runId)).filter(
      (e) => e.kind === "event" && e.event.type === "retry",
    );
    expect(retries).toMatchObject([{ event: { data: { error: "LLM output is not JSON: no" } } }]);
  });
});

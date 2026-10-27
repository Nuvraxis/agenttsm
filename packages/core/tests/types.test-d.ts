import { describe, expectTypeOf, it } from "vitest";
import type { RunCtx, Snapshot } from "../src/index.ts";
import { defineMachine } from "../src/index.ts";

describe("defineMachine types", () => {
  it("infers ctx, tools and state names", () => {
    const m = defineMachine({
      initial: "a",
      tools: { search: async (q: string) => [q] },
      states: {
        a: {
          to: ["b"],
          run: async (ctx: { topic: string }, step) => {
            expectTypeOf(step.tools.search).toEqualTypeOf<(q: string) => Promise<string[]>>();
            const parsed = step.llm.completeJson({ prompt: "p", parse: (v) => v as { n: 1 } });
            expectTypeOf(parsed).toEqualTypeOf<Promise<{ n: 1 }>>();
            const { to } = await step.route(["b"], ctx.topic);
            expectTypeOf(to).toEqualTypeOf<"b">();
            return to;
          },
        },
        b: {
          run: (ctx: RunCtx<{ topic: string }>) => {
            expectTypeOf(ctx.lastInput).toBeUnknown();
            return { done: true };
          },
        },
      },
    });
    expectTypeOf(m.start).parameter(0).toEqualTypeOf<{ topic: string }>();
    expectTypeOf(m.start).returns.resolves.toEqualTypeOf<Snapshot<{ topic: string }>>();
  });

  it("rejects unknown state names at compile time", () => {
    defineMachine({
      // @ts-expect-error "z" is not a state
      initial: "z",
      states: {
        a: {
          // @ts-expect-error "c" is not a state
          to: ["c"],
          // @ts-expect-error handlers can only return declared state names
          run: () => "c",
        },
        b: { run: () => ({ done: true }) },
      },
    });
  });
});

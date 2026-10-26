import type { HttpHandlers } from "@nuvraxis-org/agenttsm";
import { defineMachine } from "@nuvraxis-org/agenttsm";
import { pickLLM } from "examples-shared";

export type Ctx = { orderId: string; reason: string; recommendation: string; decision: string };

async function create(): Promise<HttpHandlers> {
  const machine = defineMachine({
    initial: "assess",
    llm: await pickLLM(Array.from({ length: 100 }, () => "Approve: the item arrived damaged.")),
    states: {
      assess: {
        to: ["decide"],
        run: async (ctx: Ctx, step) => {
          const { text } = await step.llm.complete({
            prompt: `Order ${ctx.orderId} asks for a refund because: ${ctx.reason}. Recommend approve or deny in one line.`,
          });
          ctx.recommendation = text.trim();
          return { to: "decide", wait: { kind: "human", prompt: "Approve the refund?" } };
        },
      },
      decide: {
        run: (ctx) => {
          ctx.decision = ctx.lastInput === "approve" ? "refunded" : "denied";
          return { done: true };
        },
      },
    },
  });
  return machine.http();
}

const shared = globalThis as typeof globalThis & { agenttsmHandlers?: Promise<HttpHandlers> };

export function handlers(): Promise<HttpHandlers> {
  shared.agenttsmHandlers ??= create();
  return shared.agenttsmHandlers;
}

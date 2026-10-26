import { defineMachine } from "@nuvraxis-org/agenttsm";
import { pickLLM } from "examples-shared";

export type Ctx = { customer: string; amountUsd: number; email: string; sent: boolean };

type Decision = { approved: boolean; note?: string };

const isDecision = (value: unknown): value is Decision =>
  typeof value === "object" && value !== null && typeof (value as Decision).approved === "boolean";

export const machine = defineMachine({
  initial: "draft",
  llm: await pickLLM([
    "Hi Sajan, we have refunded $42.00 to your card. It should arrive within 5 business days.",
  ]),
  states: {
    draft: {
      to: ["send"],
      run: async (ctx: Ctx, step) => {
        const { text } = await step.llm.complete({
          prompt: `Write a two-sentence email telling ${ctx.customer} we refunded $${ctx.amountUsd.toFixed(2)}.`,
        });
        ctx.email = text.trim();
        return { to: "send", wait: { kind: "human", prompt: "Approve this refund email?" } };
      },
    },
    send: {
      to: ["draft"],
      final: true,
      run: (ctx) => {
        if (!isDecision(ctx.lastInput) || !ctx.lastInput.approved) return "draft";
        ctx.sent = true;
        return { done: true };
      },
    },
  },
});

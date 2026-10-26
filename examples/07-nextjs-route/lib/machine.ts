import type { HttpHandlers } from "@nuvraxis-org/agenttsm";
import { defineMachine } from "@nuvraxis-org/agenttsm";
import { bearerToken, pickLLM, sameSecret } from "examples-shared";

export type Ctx = { orderId: string; reason: string; recommendation: string; decision: string };

// Stand-in for a real session check: every route needs the staff token in REFUND_API_TOKEN,
// and nothing is allowed while it is unset.
function authorize(request: Request): boolean | Response {
  const expected = process.env.REFUND_API_TOKEN;
  const token = bearerToken(request);
  if (!expected || !token) return Response.json({ error: "unauthorized" }, { status: 401 });
  return sameSecret(token, expected);
}

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
  return machine.http({ authorize });
}

const shared = globalThis as typeof globalThis & { agenttsmHandlers?: Promise<HttpHandlers> };

export function handlers(): Promise<HttpHandlers> {
  shared.agenttsmHandlers ??= create();
  return shared.agenttsmHandlers;
}

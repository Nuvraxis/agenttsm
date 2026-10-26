import type { Step } from "@nuvraxis-org/agenttsm";
import { defineMachine } from "@nuvraxis-org/agenttsm";
import { pickLLM } from "examples-shared";

type Ctx = { ticket: string; reply: string };

const reply = (team: string) => async (ctx: Ctx, step: Pick<Step<string, unknown>, "llm">) => {
  const { text } = await step.llm.complete({
    system: `You are the ${team} team. Answer in one short sentence.`,
    prompt: ctx.ticket,
  });
  ctx.reply = `[${team}] ${text.trim()}`;
  return { done: true } as const;
};

const machine = defineMachine({
  initial: "triage",
  llm: await pickLLM([
    "Hmm, this sounds like a billing thing?",
    "billing",
    "Sorry about the double charge, a refund for the second payment is on its way.",
  ]),
  states: {
    triage: {
      to: ["billing", "technical", "sales"],
      run: (ctx: Ctx, step) =>
        step.route(
          ["billing", "technical", "sales"],
          `Which team should handle this support ticket?\n\nTicket: ${ctx.ticket}`,
        ),
    },
    billing: { run: reply("billing") },
    technical: { run: reply("technical") },
    sales: { run: reply("sales") },
  },
});

machine.on("route", (event) => {
  const { attempt, answer, to } = event.data as {
    attempt: number;
    answer: string;
    to: string | null;
  };
  console.log(
    `route attempt ${attempt}: ${JSON.stringify(answer)} -> ${to ?? "invalid, asking again"}`,
  );
});
machine.on("transition", (event) => {
  const { from, to } = event.data as { from: string; to: string };
  console.log(`transition ${from} -> ${to}`);
});

const run = await machine.start({
  ticket: "I was charged twice for my October invoice.",
  reply: "",
});
console.log(`\n${run.status}: ${run.ctx.reply}`);

if (run.status !== "done") process.exitCode = 1;

import { defineMachine } from "@nuvraxis-org/agenttsm";
import { pickLLM } from "examples-shared";

type Ctx = { name: string; greeting: string };

const machine = defineMachine({
  initial: "greet",
  llm: await pickLLM(["Hello, Sajan! Welcome aboard."]),
  states: {
    greet: {
      to: ["shout"],
      run: async (ctx: Ctx, step) => {
        const { text } = await step.llm.complete({
          prompt: `Write a one-line friendly greeting for ${ctx.name}. Reply with the greeting only.`,
        });
        ctx.greeting = text.trim();
        return "shout";
      },
    },
    shout: {
      to: ["sign"],
      run: (ctx: Ctx) => {
        ctx.greeting = ctx.greeting.toUpperCase();
        return "sign";
      },
    },
    sign: {
      run: (ctx: Ctx) => {
        ctx.greeting = `${ctx.greeting} (sent by agenttsm)`;
        return { done: true };
      },
    },
  },
});

machine.on("transition", (event) => {
  const { from, to } = event.data as { from: string; to: string };
  console.log(`transition  ${from} -> ${to}`);
});
machine.on("done", (event) => console.log(`done        in state ${event.state}`));

const run = await machine.start({ name: "Sajan", greeting: "" });
console.log(`\nstatus: ${run.status}, steps: ${run.step}`);
console.log(`greeting: ${run.ctx.greeting}`);

if (run.status !== "done") process.exitCode = 1;

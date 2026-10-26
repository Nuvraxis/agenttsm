import { defineMachine } from "@nuvraxis-org/agenttsm";
import { fakeTools } from "@nuvraxis-org/agenttsm/testing";
import { pickLLM } from "examples-shared";

const log = (label: string) => (event: { type: string; state: string; data?: unknown }) =>
  console.log(
    `[${label}] ${event.type.padEnd(10)} ${event.state} ${JSON.stringify(event.data ?? {})}`,
  );

function slowLookup(ms: number, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(`answered after ${ms}ms`), ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

const flaky = defineMachine({
  initial: "fetchPrice",
  retry: { baseMs: 50, maxMs: 400 },
  tools: fakeTools({
    price: [
      { error: "503 upstream unavailable" },
      { error: "503 upstream unavailable" },
      { value: 101.5 },
    ],
  }),
  llm: await pickLLM(["ACME trades at $101.50."]),
  states: {
    fetchPrice: {
      to: ["summarize"],
      maxRetries: 3,
      run: async (ctx: { symbol: string; price?: number; summary?: string }, step) => {
        ctx.price = Number(await step.tools.price(ctx.symbol));
        return "summarize";
      },
    },
    summarize: {
      run: async (ctx, step) => {
        const { text } = await step.llm.complete({
          prompt: `Summarize: ${ctx.symbol} costs ${ctx.price} USD.`,
        });
        ctx.summary = text.trim();
        return { done: true };
      },
    },
  },
});
flaky.on("*", log("flaky tool"));

const slow = defineMachine({
  initial: "lookup",
  retry: { baseMs: 10 },
  states: {
    lookup: {
      timeoutMs: 100,
      maxRetries: 1,
      run: async (ctx: { answer?: string }, step) => {
        ctx.answer = await slowLookup(step.attempt === 0 ? 1_000 : 20, step.signal);
        return { done: true };
      },
    },
  },
});
slow.on("*", log("timeout"));

const runaway = defineMachine({
  initial: "poll",
  guards: { maxSteps: 5 },
  states: {
    poll: {
      to: ["poll"],
      run: (ctx: { polls: number }) => {
        ctx.polls += 1;
        return "poll";
      },
    },
  },
});
runaway.on("failed", log("guard"));

const a = await flaky.start({ symbol: "ACME" });
console.log(`-> ${a.status}: ${a.ctx.summary}\n`);
const b = await slow.start({});
console.log(`-> ${b.status}: ${b.ctx.answer}\n`);
const c = await runaway.start({ polls: 0 });
console.log(`-> ${c.status} after ${c.ctx.polls} polls: ${c.reason}`);

if (a.status !== "done" || b.status !== "done" || c.status !== "failed") process.exitCode = 1;

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineMachine } from "@nuvraxis-org/agenttsm";
import { pickLLM } from "examples-shared";

type Ctx = { topic: string; queries: string[]; sources: string[]; draft: string; feedback: string };

const corpus: Record<string, string> = {
  "durable execution":
    "Durable execution persists workflow state after every step so it can resume after a crash.",
  "human in the loop":
    "Human-in-the-loop steps pause a workflow until a person approves or edits the result.",
  "llm cost control":
    "Budgets and token limits stop runaway agent loops before they get expensive.",
};

async function search(query: string): Promise<string[]> {
  const words = query.toLowerCase().split(/\W+/);
  return Object.entries(corpus)
    .filter(([key]) => key.split(" ").some((word) => words.includes(word)))
    .map(([, text]) => text);
}

const metered = (text: string) => ({ text, tokens: 400, costUsd: 0.004 });

const machine = defineMachine({
  initial: "plan",
  guards: { budgetUsd: 0.05, maxSteps: 12 },
  tools: { search },
  llm: await pickLLM([
    metered("durable execution\nhuman in the loop\nllm cost control"),
    metered("Agent workflows need durable state and human checkpoints."),
    metered("REVISE: mention cost control."),
    metered(
      "Agent workflows need durable state, human checkpoints and budgets that stop runaway loops.",
    ),
    metered("APPROVE"),
  ]),
  states: {
    plan: {
      to: ["search"],
      run: async (ctx: Ctx, step) => {
        const { text } = await step.llm.complete({
          prompt: `List three search queries, one per line, for a short brief on: ${ctx.topic}`,
        });
        ctx.queries = text
          .split("\n")
          .map((q) => q.trim())
          .filter(Boolean)
          .slice(0, 3);
        return "search";
      },
    },
    search: {
      to: ["draft"],
      maxRetries: 2,
      run: async (ctx, step) => {
        const results = await Promise.all(ctx.queries.map((q) => step.tools.search(q)));
        ctx.sources = [...new Set(results.flat())];
        return "draft";
      },
    },
    draft: {
      to: ["review"],
      run: async (ctx, step) => {
        const { text } = await step.llm.complete({
          prompt: `Write a one-sentence brief on ${ctx.topic}.\nSources:\n${ctx.sources.join("\n")}\n${ctx.feedback}`,
        });
        ctx.draft = text.trim();
        return "review";
      },
    },
    review: {
      to: ["draft"],
      final: true,
      run: async (ctx, step) => {
        const { text } = await step.llm.complete({
          prompt: `Reply APPROVE or "REVISE: <what to change>" for this brief:\n${ctx.draft}`,
        });
        if (text.trim().toUpperCase().startsWith("APPROVE")) return { done: true };
        ctx.feedback = text.trim();
        return "draft";
      },
    },
  },
});

const graph = new URL("../graph.md", import.meta.url);
await writeFile(graph, `# Research pipeline\n\n\`\`\`mermaid\n${machine.toMermaid()}\n\`\`\`\n`);
console.log(`wrote ${fileURLToPath(graph)}\n`);

machine.on("transition", (event) => {
  const { from, to } = event.data as { from: string; to: string };
  console.log(`${from} -> ${to}`);
});

const run = await machine.start({
  topic: "agent workflows",
  queries: [],
  sources: [],
  draft: "",
  feedback: "",
});
console.log(
  `\n${run.status} after ${run.step} steps, ${run.usage.tokens} tokens, $${run.usage.costUsd.toFixed(3)}`,
);
console.log(`brief: ${run.ctx.draft}`);
if (run.reason) console.log(`reason: ${run.reason}`);

if (run.status !== "done") process.exitCode = 1;

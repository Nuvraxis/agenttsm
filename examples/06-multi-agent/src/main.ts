import { defineMachine } from "@nuvraxis-org/agenttsm";
import { pickLLM } from "examples-shared";

type Ctx = {
  question: string;
  notes: string;
  draft: string;
  critiques: string[];
  published: string;
};

const docs = [
  "agenttsm saves a snapshot after every step.",
  "A wait transition parks the run until resume() is called.",
  "Guards stop a run that exceeds maxSteps, maxTokens, budgetUsd or deadlineMs.",
];

const tools = {
  searchDocs: async (query: string) =>
    docs.filter((doc) =>
      query
        .toLowerCase()
        .split(/\W+/)
        .some((word) => word.length > 3 && doc.toLowerCase().includes(word)),
    ),
  wordCount: (text: string) => text.split(/\s+/).filter(Boolean).length,
};

const agents = {
  researcher: {
    system: "You are a researcher. Summarize the facts you are given as bullet notes.",
    tools: ["searchDocs"],
  },
  writer: {
    system: "You are a technical writer. Write a three-sentence answer from the notes.",
    tools: [],
  },
  critic: {
    system: "You are a strict editor. Decide whether the draft is ready.",
    tools: ["wordCount"],
  },
} as const;

const machine = defineMachine({
  initial: "researcher",
  tools,
  llm: await pickLLM([
    "- snapshots after every step\n- waits park the run\n- guards stop runaway runs",
    "agenttsm keeps a snapshot of every step. Runs can pause for people. Guards stop them going too far.",
    "writer",
    "agenttsm saves a snapshot after every step, so a crashed run resumes where it stopped. A wait transition parks the run until someone calls resume(). Guards end runs that exceed their step, token, budget or time limits.",
    "publisher",
  ]),
  states: {
    researcher: {
      to: ["writer"],
      run: async (ctx: Ctx, step) => {
        const facts = await step.tools.searchDocs(ctx.question);
        const { text } = await step.llm.complete({
          system: agents.researcher.system,
          prompt: `Question: ${ctx.question}\nFacts:\n${facts.join("\n")}`,
        });
        ctx.notes = text.trim();
        return "writer";
      },
    },
    writer: {
      to: ["critic"],
      run: async (ctx, step) => {
        const feedback = ctx.critiques.length
          ? `\nEditor feedback: ${ctx.critiques.join("; ")}`
          : "";
        const { text } = await step.llm.complete({
          system: agents.writer.system,
          prompt: `Question: ${ctx.question}\nNotes:\n${ctx.notes}${feedback}`,
        });
        ctx.draft = text.trim();
        return "critic";
      },
    },
    critic: {
      to: ["writer", "publisher"],
      run: (ctx, step) => {
        const words = step.tools.wordCount(ctx.draft);
        if (words < 30) ctx.critiques.push(`too short (${words} words), add detail`);
        return step.route(
          ["writer", "publisher"],
          `${agents.critic.system}\nDraft (${words} words):\n${ctx.draft}\nReply "publisher" if it is ready, or "writer" to send it back.`,
        );
      },
    },
    publisher: {
      run: (ctx) => {
        ctx.published = `Q: ${ctx.question}\nA: ${ctx.draft}`;
        return { done: true };
      },
    },
  },
});

machine.on("transition", (event) => {
  const { from, to } = event.data as { from: string; to: string };
  const uses =
    from in agents ? agents[from as keyof typeof agents].tools.join(", ") || "no tools" : "";
  console.log(`${from.padEnd(10)} -> ${to.padEnd(10)} ${uses && `(${uses})`}`);
});

const run = await machine.start({
  question: "How does agenttsm keep agent runs safe and resumable?",
  notes: "",
  draft: "",
  critiques: [],
  published: "",
});
console.log(`\n${run.status} after ${run.step} handoffs\n${run.ctx.published}`);

if (run.status !== "done") process.exitCode = 1;

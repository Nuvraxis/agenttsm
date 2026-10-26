# @nuvraxis-org/agenttsm

Zero dependencies, one import, under 500 lines. A small, typed state machine runtime for AI agent
workflows: per-step snapshots, retries with backoff, per-state timeouts, budgets and step guards,
and pauses for humans or webhooks that resume without re-running the paused step.

```sh
pnpm add @nuvraxis-org/agenttsm
```

```ts
import { defineMachine } from "@nuvraxis-org/agenttsm";

const machine = defineMachine({
  initial: "draft",
  states: {
    draft: { to: ["send"], run: () => ({ to: "send", wait: { kind: "human" } }) },
    send: {
      to: ["draft"],
      final: true,
      run: (ctx) => (ctx.lastInput === "approve" ? { done: true } : "draft"),
    },
  },
});

const paused = await machine.start({});
const done = await machine.resume(paused.runId, "approve");
```

Test helpers live in `@nuvraxis-org/agenttsm/testing` (`FakeLLM`, `fakeTools`).

Documentation, examples and the conformance suite: <https://github.com/Nuvraxis/agenttsm>

MIT © Sajankumar Vijayan

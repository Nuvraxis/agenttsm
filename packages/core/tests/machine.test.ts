import { afterEach, describe, expect, it, vi } from "vitest";
import type { Guards, MachineDef, RunEvent, Wait } from "../src/index.ts";
import { AgentTsmError, defineMachine, MemoryStore } from "../src/index.ts";
import { FakeLLM } from "../src/testing/index.ts";

type Ctx = { n: number };

const linear = () =>
  defineMachine({
    initial: "a",
    states: {
      a: { to: ["b"], run: () => "b" },
      b: { to: ["c"], run: () => ({ to: "c" }) },
      c: { run: () => ({ done: true }) },
    },
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("defineMachine validation", () => {
  it.each<{ name: string; def: unknown; message: string }>([
    {
      name: "unknown initial",
      def: { initial: "x", states: { a: { run: () => ({ done: true }) } } },
      message: 'initial state "x"',
    },
    {
      name: "unknown target",
      def: { initial: "a", states: { a: { to: ["zz"], run: () => "zz" } } },
      message: 'unknown state "zz"',
    },
  ])("rejects $name", ({ def, message }) => {
    const define = () => defineMachine(def as unknown as MachineDef<Ctx, string, never>);
    expect(define).toThrow(AgentTsmError);
    expect(define).toThrow(message);
  });
});

describe("transitions", () => {
  it.each([
    {
      name: "undeclared target",
      run: () => "c",
      reason: 'cannot transition to "c"',
    },
    {
      name: "finish from non-final state",
      run: () => ({ done: true }) as const,
      reason: "is not final",
    },
  ])("fails the run on $name without retrying", async ({ run, reason }) => {
    const m = defineMachine({
      initial: "a",
      states: { a: { to: ["b"], maxRetries: 3, run }, b: { run: () => ({ done: true }) } },
    } as unknown as MachineDef<Ctx, string, never>);
    const snap = await m.start({ n: 0 });
    expect(snap).toMatchObject({ status: "failed", attempt: 0 });
    expect(snap.reason).toContain(reason);
  });

  it("lets a final state with targets finish", async () => {
    const m = defineMachine({
      initial: "a",
      states: { a: { to: ["a"], final: true, run: () => ({ done: true }) } },
    });
    expect((await m.start({})).status).toBe("done");
  });

  it("isolates ctx mutations of a failed attempt", async () => {
    const m = defineMachine({
      initial: "a",
      retry: { baseMs: 0 },
      states: {
        a: {
          maxRetries: 1,
          run: (ctx: Ctx, step) => {
            ctx.n += 1;
            if (step.attempt === 0) throw new Error("first attempt fails");
            return { done: true };
          },
        },
      },
    });
    expect((await m.start({ n: 0 })).ctx.n).toBe(1);
  });

  it("does not share ctx with the caller", async () => {
    const ctx = { n: 1 };
    const m = defineMachine({
      initial: "a",
      states: {
        a: {
          run: (c: Ctx) => {
            c.n = 99;
            return { done: true };
          },
        },
      },
    });
    await m.start(ctx);
    expect(ctx.n).toBe(1);
  });

  it("keeps backoff within the jittered exponential window", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const delays: unknown[] = [];
    const m = defineMachine({
      initial: "a",
      retry: { baseMs: 2, maxMs: 4 },
      states: {
        a: {
          maxRetries: 3,
          run: () => {
            throw "plain string error";
          },
        },
      },
    });
    m.on("retry", (e) => delays.push((e.data as { delayMs: number }).delayMs));
    const snap = await m.start({});
    expect(delays).toEqual([2, 4, 4]);
    expect(snap.reason).toBe("plain string error");
  });
});

describe("guards", () => {
  const cases: { name: string; guards: Guards; reason: string }[] = [
    { name: "maxTokens", guards: { maxTokens: 15 }, reason: "maxTokens guard breached: 20 > 15" },
    { name: "budgetUsd", guards: { budgetUsd: 0.01 }, reason: "budgetUsd guard breached" },
    { name: "deadlineMs", guards: { deadlineMs: 5 }, reason: "deadlineMs guard breached" },
  ];

  it.each(cases)("$name breach fails the run with a reason", async ({ guards, reason }) => {
    const llm = new FakeLLM(
      Array.from({ length: 5 }, () => ({ text: "x", tokens: 10, costUsd: 0.01 })),
    );
    const m = defineMachine({
      initial: "loop",
      guards,
      llm,
      states: {
        loop: {
          to: ["loop"],
          run: async (_ctx, step) => {
            await step.llm.complete({ prompt: "go" });
            await new Promise((resolve) => setTimeout(resolve, 5));
            return "loop";
          },
        },
      },
    });
    const snap = await m.start({});
    expect(snap.status).toBe("failed");
    expect(snap.reason).toContain(reason);
  });

  it("fails when a state uses step.llm without an llm", async () => {
    const m = defineMachine({
      initial: "a",
      states: {
        a: {
          run: async (_ctx, step) => {
            await step.llm.complete({ prompt: "hi" });
            return { done: true };
          },
        },
      },
    });
    expect((await m.start({})).reason).toContain("no llm");
  });
});

describe("waits", () => {
  const gate = {
    initial: "ask",
    states: {
      ask: { to: ["go"], run: () => ({ to: "go", wait: { kind: "human" } }) as const },
      go: { run: () => ({ done: true }) as const },
    },
  } as const;

  it("throws not_found when resuming an unknown run", async () => {
    await expect(defineMachine(gate).resume("nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("resumes without input and keeps ctx unchanged", async () => {
    const m = defineMachine(gate);
    const waiting = await m.start({ n: 1 });
    const done = await m.resume(waiting.runId);
    expect(done).toMatchObject({ status: "done", ctx: { n: 1 } });
    expect(done.ctx).not.toHaveProperty("lastInput");
    expect(done).not.toHaveProperty("waiting");
  });

  it("re-arms timers that fire before an until deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const at = new Date(Date.now() + 60_000).toISOString();
    const m = defineMachine({
      initial: "a",
      states: {
        a: { to: ["b"], run: () => ({ to: "b", wait: { kind: "until", at } }) },
        b: { run: () => ({ done: true }) },
      },
    });
    const snap = await m.start({});
    vi.setSystemTime(Date.now() - 1_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await m.get(snap.runId))?.status).toBe("waiting");
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await m.get(snap.runId))?.status).toBe("done");
  });

  it("logs a scheduled resume that fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = defineMachine({
      initial: "a",
      store: {
        save: async (snapshot) => {
          if (snapshot.version > 3) throw new Error("disk full");
          saved.set(snapshot.runId, snapshot);
        },
        load: async (runId) => saved.get(runId),
        list: async () => [],
        trace: async () => [],
      },
      states: {
        a: { to: ["b"], run: () => ({ to: "b", wait: { kind: "sleep", ms: 0 } }) },
        b: { run: () => ({ done: true }) },
      },
    });
    const saved = new Map<
      string,
      Parameters<NonNullable<MachineDef<object, string, never>["store"]>["save"]>[0]
    >();
    await m.start({});
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith("agenttsm: scheduled resume failed", expect.any(Error)),
    );
  });
});

describe("poll()", () => {
  const timed = (wait: Wait) =>
    ({
      initial: "a",
      timers: false,
      states: {
        a: { to: ["b"], run: () => ({ to: "b", wait }) as const },
        b: { run: () => ({ done: true }) as const },
      },
    }) as const;

  it("resumes only due sleep and until waits", async () => {
    const store = new MemoryStore();
    const past = new Date(Date.now() - 1_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    const runs = await Promise.all(
      [
        { kind: "sleep", ms: 0 },
        { kind: "until", at: past },
        { kind: "sleep", ms: 60_000 },
        { kind: "until", at: future },
        { kind: "human" },
        { kind: "webhook", name: "paid" },
      ].map((wait) => defineMachine({ ...timed(wait as Wait), store }).start({})),
    );
    const resumed = await defineMachine({ ...timed({ kind: "human" }), store }).poll();
    expect(resumed.map((s) => s.runId).sort()).toEqual([runs[0]?.runId, runs[1]?.runId].sort());
    expect(resumed.every((s) => s.status === "done")).toBe(true);
    expect(await store.list({ status: "waiting" })).toHaveLength(4);
  });

  it("resumes a run once when several pollers race on one store", async () => {
    const store = new MemoryStore();
    const def = { ...timed({ kind: "sleep", ms: 0 }), store };
    const snap = await defineMachine(def).start({});
    const results = await Promise.all([1, 2, 3].map(() => defineMachine(def).poll()));
    expect(results.flat()).toHaveLength(1);
    expect(
      (await store.trace(snap.runId)).filter(
        (e) => e.kind === "event" && e.event.type === "resume",
      ),
    ).toHaveLength(1);
  });

  it("rethrows store errors other than conflicts", async () => {
    const store = new MemoryStore();
    const def = { ...timed({ kind: "sleep", ms: 0 }), store };
    await defineMachine(def).start({});
    vi.spyOn(store, "save").mockRejectedValue(new Error("disk full"));
    await expect(defineMachine(def).poll()).rejects.toThrow("disk full");
  });

  it("is a no-op for a machine whose timers already resumed the run", async () => {
    const store = new MemoryStore();
    const m = defineMachine({ ...timed({ kind: "sleep", ms: 0 }), timers: true, store });
    const snap = await m.start({});
    await vi.waitFor(async () => expect((await m.get(snap.runId))?.status).toBe("done"));
    expect(await m.poll()).toEqual([]);
  });
});

describe("events", () => {
  it("delivers typed and wildcard listeners and supports unsubscribe", async () => {
    const m = linear();
    const typed: RunEvent[] = [];
    const all: string[] = [];
    const off = m.on("transition", (e) => typed.push(e));
    m.on("*", (e) => all.push(e.type));
    await m.start({});
    off();
    await m.start({});
    expect(typed).toHaveLength(2);
    expect(all).toEqual(["transition", "transition", "done", "transition", "transition", "done"]);
  });

  it("isolates listener errors from the run", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const m = linear();
    m.on("done", () => {
      throw new Error("listener bug");
    });
    expect((await m.start({})).status).toBe("done");
    expect(error).toHaveBeenCalledWith("agenttsm: listener failed", expect.any(Error));
  });

  it("records custom events emitted by handlers in the trace", async () => {
    const m = defineMachine({
      initial: "a",
      states: {
        a: {
          run: (_ctx, step) => {
            step.emit("note", { hello: "world" });
            step.emit("ping");
            return { done: true };
          },
        },
      },
    });
    const snap = await m.start({});
    const trace = await m.trace(snap.runId);
    expect(
      trace.map((e) => (e.kind === "event" ? e.event.type : `v${e.snapshot.version}`)),
    ).toEqual(["v1", "note", "ping", "done", "v2"]);
  });
});

describe("inspection", () => {
  it("returns undefined for unknown runs and an empty trace", async () => {
    const m = linear();
    expect(await m.get("missing")).toBeUndefined();
    expect(await m.trace("missing")).toEqual([]);
  });

  it("renders Mermaid with entry, edges and exits", () => {
    const m = defineMachine({
      initial: "plan",
      states: {
        plan: { to: ["draft"], run: () => "draft" },
        draft: { to: ["review"], run: () => "review" },
        review: { to: ["draft"], final: true, run: () => ({ done: true }) },
      },
    });
    expect(m.toMermaid()).toBe(
      [
        "stateDiagram-v2",
        "  [*] --> plan",
        "  plan --> draft",
        "  draft --> review",
        "  review --> draft",
        "  review --> [*]",
      ].join("\n"),
    );
  });
});

describe("test()", () => {
  const flow = {
    initial: "ask",
    states: {
      ask: { to: ["nap"], run: () => ({ to: "nap", wait: { kind: "human" } }) as const },
      nap: {
        to: ["end"],
        run: () => ({ to: "end", wait: { kind: "sleep", ms: 60_000 } }) as const,
      },
      end: {
        run: async (
          ctx: { answer?: unknown; lastInput?: unknown },
          step: { llm: { complete: FakeLLM["complete"] } },
        ) => {
          ctx.answer = (await step.llm.complete({ prompt: String(ctx.lastInput) })).text;
          return { done: true } as const;
        },
      },
    },
  } as const;

  it("feeds scripted inputs, skips timed waits and returns the trace", async () => {
    const m = defineMachine(flow);
    const result = await m.test({}, { inputs: ["yes"], llm: new FakeLLM(["ok"]) });
    expect(result.snapshot).toMatchObject({ status: "done", ctx: { answer: "ok" } });
    expect(result.snapshot.ctx).not.toHaveProperty("lastInput");
    expect(result.trace.filter((e) => e.kind === "snapshot")).toHaveLength(6);
    expect(await m.get(result.snapshot.runId)).toBeUndefined();
  });

  it("stops at a human wait when inputs run out", async () => {
    const result = await defineMachine({ ...flow, llm: new FakeLLM([]) }).test({});
    expect(result.snapshot).toMatchObject({
      status: "waiting",
      state: "nap",
      waiting: { kind: "human" },
    });
  });
});

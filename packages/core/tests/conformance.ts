import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type {
  Guards,
  LLMResponse,
  Machine,
  RetryPolicy,
  Snapshot,
  StateDef,
  Store,
  Transition,
} from "../src/index.ts";
import { defineMachine } from "../src/index.ts";
import type { FakeTool, ToolScript } from "../src/testing/index.ts";
import { FakeLLM, fakeTools } from "../src/testing/index.ts";

type Ctx = Record<string, unknown>;
type Tools = Record<string, FakeTool>;

type Action =
  | { count: string }
  | { tool: string; as: string }
  | { llm: string; as: string }
  | { llmJson: string; as: string }
  | { copyInput: string }
  | { emit: string; data?: unknown }
  | { delay: number }
  | { route: string[]; prompt: string };

interface ScenarioState {
  to?: string[];
  final?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
  do?: Action[];
  then?: Transition;
}

type Op =
  | { check: Partial<Snapshot> }
  | { waitFor: Partial<Snapshot> }
  | { resume: { input?: unknown }; noop?: boolean }
  | { resumeConcurrently: { count: number; input?: unknown } }
  | { restart: true }
  | { poll: { resumed: number } };

export interface Scenario {
  file: string;
  name: string;
  rules: number[];
  machine: {
    initial: string;
    guards?: Guards;
    retry?: RetryPolicy;
    timers?: boolean;
    states: Record<string, ScenarioState>;
  };
  tools?: Record<string, ToolScript[]>;
  llm?: LLMResponse[];
  ctx: Ctx;
  ops?: Op[];
  expect: Partial<Snapshot> & {
    defineError?: string;
    reasonContains?: string;
    events?: object[];
    snapshots?: object[];
    toolCalls?: Record<string, number>;
    llmCalls?: number;
  };
}

const dir = new URL("../../../conformance/", import.meta.url);

export const scenarios: Scenario[] = readdirSync(dir)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => ({ file, ...JSON.parse(readFileSync(new URL(file, dir), "utf8")) }));

const isConflict = (error: unknown): boolean =>
  error instanceof Error && (error as { code?: unknown }).code === "conflict";

function jsonObject(value: unknown): Ctx {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected a JSON object");
  }
  return value as Ctx;
}

function toState({
  do: actions = [],
  then = { done: true },
  ...rest
}: ScenarioState): StateDef<Ctx, string, Tools> {
  return {
    ...rest,
    async run(ctx, step) {
      for (const action of actions) {
        if ("count" in action) ctx[action.count] = Number(ctx[action.count] ?? 0) + 1;
        else if ("copyInput" in action) ctx[action.copyInput] = ctx.lastInput ?? null;
        else if ("emit" in action) step.emit(action.emit, action.data);
        else if ("delay" in action)
          await new Promise((resolve) => setTimeout(resolve, action.delay));
        else if ("route" in action) return step.route(action.route, action.prompt);
        else if ("llm" in action)
          ctx[action.as] = (await step.llm.complete({ prompt: action.llm })).text;
        else if ("llmJson" in action)
          ctx[action.as] = await step.llm.completeJson({
            prompt: action.llmJson,
            parse: jsonObject,
          });
        else {
          const tool = step.tools[action.tool];
          if (!tool) throw new Error(`scenario has no tool "${action.tool}"`);
          ctx[action.as] = await tool(ctx);
        }
      }
      return then;
    },
  };
}

async function reload(machine: Machine<Ctx, Tools>, runId: string): Promise<Snapshot<Ctx>> {
  const snapshot = await machine.get(runId);
  if (!snapshot) throw new Error(`run "${runId}" disappeared from the store`);
  return snapshot;
}

async function apply(
  machine: Machine<Ctx, Tools>,
  snapshot: Snapshot<Ctx>,
  op: Exclude<Op, { restart: true }>,
): Promise<Snapshot<Ctx>> {
  if ("check" in op) {
    expect(snapshot).toMatchObject(op.check);
    return snapshot;
  }
  if ("waitFor" in op) {
    return vi.waitFor(async () => {
      const current = await machine.get(snapshot.runId);
      expect(current).toMatchObject(op.waitFor);
      return current as Snapshot<Ctx>;
    });
  }
  if ("resume" in op) {
    const next = await machine.resume(snapshot.runId, op.resume.input);
    if (op.noop) expect(next).toEqual(snapshot);
    return next;
  }
  if ("poll" in op) {
    expect(await machine.poll()).toHaveLength(op.poll.resumed);
    return reload(machine, snapshot.runId);
  }
  const { count, input } = op.resumeConcurrently;
  const results = await Promise.allSettled(
    Array.from({ length: count }, () => machine.resume(snapshot.runId, input)),
  );
  for (const result of results) {
    if (result.status === "rejected" && !isConflict(result.reason)) throw result.reason;
  }
  expect(results.some((r) => r.status === "fulfilled")).toBe(true);
  return reload(machine, snapshot.runId);
}

/**
 * Runs every scenario in `conformance/` against stores from `makeStore`. It is called once per
 * scenario, and each scenario's runs must be the only ones the store holds.
 */
export function describeConformance(label: string, makeStore: () => Store | Promise<Store>): void {
  describe(`conformance (${label})`, () => {
    it.each(scenarios)("$file: $name", async (scenario) => {
      const llm = new FakeLLM(scenario.llm ?? []);
      const tools = fakeTools(scenario.tools ?? {});
      const states = Object.fromEntries(
        Object.entries(scenario.machine.states).map(([k, v]) => [k, toState(v)]),
      );
      const { defineError, reasonContains, events, snapshots, toolCalls, llmCalls, ...fields } =
        scenario.expect;
      if (defineError) {
        expect(() => defineMachine({ ...scenario.machine, states })).toThrow(defineError);
        return;
      }

      const store = await makeStore();
      const define = () =>
        defineMachine<Ctx, string, Tools>({ ...scenario.machine, states, llm, tools, store });
      let machine = define();
      let snapshot = await machine.start(scenario.ctx);
      for (const op of scenario.ops ?? []) {
        if ("restart" in op) {
          machine = define();
          snapshot = await reload(machine, snapshot.runId);
        } else {
          snapshot = await apply(machine, snapshot, op);
        }
      }

      expect(snapshot).toMatchObject(fields);
      if (reasonContains) expect(snapshot.reason).toContain(reasonContains);
      const trace = await machine.trace(snapshot.runId);
      if (events)
        expect(trace.flatMap((e) => (e.kind === "event" ? [e.event] : []))).toMatchObject(events);
      if (snapshots)
        expect(trace.flatMap((e) => (e.kind === "snapshot" ? [e.snapshot] : []))).toMatchObject(
          snapshots,
        );
      for (const [name, calls] of Object.entries(toolCalls ?? {}))
        expect(tools[name]?.calls).toHaveLength(calls);
      if (llmCalls !== undefined) expect(llm.calls).toHaveLength(llmCalls);
    });
  });
}

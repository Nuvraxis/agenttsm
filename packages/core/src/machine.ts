import { AgentTsmError } from "./errors.ts";
import { httpHandlers } from "./http.ts";
import { parseJsonOutput } from "./json.ts";
import { toMermaid } from "./mermaid.ts";
import { createRoute } from "./route.ts";
import { MemoryStore } from "./store.ts";
import type * as t from "./types.ts";

type Shape = { to?: readonly string[]; final?: boolean };
type Next = { done: true } | { to: string; wait?: t.Wait };
type Outcome = { events: t.RunEvent[]; usage: t.Usage };
type Attempt<C extends object> =
  | (Outcome & { ok: true; ctx: t.RunCtx<C>; transition: t.Transition })
  | (Outcome & { ok: false; reason: string });

const MAX_TIMER_MS = 2 ** 31 - 1;

const now = (): string => new Date().toISOString();
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function abortable<T>(run: () => T | Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(run)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function validate(initial: string, states: Record<string, Shape>): void {
  const names = new Set(Object.keys(states));
  if (!names.has(initial)) {
    throw new AgentTsmError("definition", `initial state "${initial}" is not a defined state`);
  }
  for (const [name, state] of Object.entries(states)) {
    const unknown = state.to?.find((to) => !names.has(to));
    if (unknown !== undefined) {
      throw new AgentTsmError("definition", `state "${name}" targets unknown state "${unknown}"`);
    }
  }
}

function resolveNext(name: string, state: Shape, transition: t.Transition): Next | string {
  const next = typeof transition === "string" ? { to: transition } : transition;
  if ("done" in next)
    return !state.to?.length || state.final ? next : `state "${name}" is not final`;
  return state.to?.includes(next.to) ? next : `state "${name}" cannot transition to "${next.to}"`;
}

function withInput<C extends object>(ctx: t.RunCtx<C>, input: unknown): t.RunCtx<C> {
  const next = { ...ctx };
  if (input === undefined) delete next.lastInput;
  else next.lastInput = input;
  return next;
}

function breach({ step, usage, createdAt }: t.Snapshot, guards: t.Guards = {}): string | undefined {
  const measured: [keyof t.Guards, number][] = [
    ["maxSteps", step + 1],
    ["maxTokens", usage.tokens],
    ["budgetUsd", usage.costUsd],
    ["deadlineMs", Date.now() - Date.parse(createdAt)],
  ];
  for (const [guard, value] of measured) {
    const limit = guards[guard];
    if (limit !== undefined && value > limit) return `${guard} guard breached: ${value} > ${limit}`;
  }
  return undefined;
}

export function defineMachine<
  C extends object = Record<string, unknown>,
  const S extends string = string,
  T = Record<never, never>,
>(def: t.MachineDef<C, S, T>): t.Machine<C, T> {
  validate(def.initial, def.states);
  return build(def, true);
}

function build<C extends object, S extends string, T>(
  def: t.MachineDef<C, S, T>,
  timers: boolean,
): t.Machine<C, T> {
  type Snap = t.Snapshot<C>;
  const store = def.store ?? new MemoryStore();
  const tools = def.tools ?? ({} as T);
  const listeners = new Map<string, Set<t.Listener>>();

  const event = (snap: Snap, type: t.EventType, data?: unknown): t.RunEvent => ({
    type,
    runId: snap.runId,
    state: snap.state,
    at: now(),
    ...(data === undefined ? {} : { data }),
  });

  const deliver = (e: t.RunEvent): void => {
    for (const listener of [...(listeners.get(e.type) ?? []), ...(listeners.get("*") ?? [])]) {
      try {
        listener(e);
      } catch (error) {
        console.error("agenttsm: listener failed", error);
      }
    }
  };

  async function commit(next: Snap, events: t.RunEvent[]): Promise<Snap> {
    const saved = { ...next, version: next.version + 1, updatedAt: now() };
    await store.save(saved, events);
    events.forEach(deliver);
    return saved;
  }

  const fail = (snap: Snap, reason: string, { events, usage }: Outcome): Promise<Snap> =>
    commit({ ...snap, status: "failed", reason, usage }, [
      ...events,
      event(snap, "failed", { reason }),
    ]);

  function backoff(attempt: number): number {
    const ceiling = Math.min(def.retry?.maxMs ?? 10_000, (def.retry?.baseMs ?? 100) * 2 ** attempt);
    return Math.round(ceiling / 2 + (Math.random() * ceiling) / 2);
  }

  async function attempt(snap: Snap, state: t.StateDef<C, S, T>): Promise<Attempt<C>> {
    const events: t.RunEvent[] = [];
    const usage = { ...snap.usage };
    const ctx = structuredClone(snap.ctx);
    const { timeoutMs } = state;
    const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : new AbortController().signal;
    const complete = async (request: t.LLMRequest): Promise<t.LLMResponse> => {
      if (!def.llm) throw new AgentTsmError("definition", "no llm was passed to defineMachine");
      const response = await def.llm.complete({ signal, ...request });
      usage.tokens += response.tokens ?? 0;
      usage.costUsd += response.costUsd ?? 0;
      return response;
    };
    const llm: t.StepLLM = {
      complete,
      completeJson: async ({ parse, ...request }) =>
        parseJsonOutput((await complete(request)).text, parse),
    };
    const emit = (type: t.EventType, data?: unknown): void => {
      events.push(event(snap, type, data));
    };
    const route = createRoute(llm, emit);
    const step: t.Step<S, T> = { signal, attempt: snap.attempt, tools, llm, emit, route };
    try {
      const transition = await abortable(() => state.run(ctx, step), signal);
      return { ok: true, ctx, events, usage, transition };
    } catch (error) {
      const timeout = `timeout: state "${snap.state}" exceeded ${timeoutMs}ms`;
      return { ok: false, events, usage, reason: signal.aborted ? timeout : reasonOf(error) };
    }
  }

  async function drive(start: Snap): Promise<Snap> {
    let snap = start;
    while (snap.status === "running") {
      const guard = breach(snap, def.guards);
      if (guard) return fail(snap, guard, { events: [], usage: snap.usage });
      const state = def.states[snap.state as S];
      const result = await attempt(snap, state);
      if (!result.ok) {
        if (snap.attempt >= (state.maxRetries ?? 0)) return fail(snap, result.reason, result);
        const data = {
          attempt: snap.attempt + 1,
          delayMs: backoff(snap.attempt),
          error: result.reason,
        };
        const events = [...result.events, event(snap, "retry", data)];
        snap = await commit({ ...snap, attempt: data.attempt, usage: result.usage }, events);
        await sleep(data.delayMs);
        continue;
      }
      const next = resolveNext(snap.state, state, result.transition);
      if (typeof next === "string") return fail(snap, next, result);
      const { ctx, usage, events } = result;
      const base = { ...snap, ctx, usage, step: snap.step + 1, attempt: 0 };
      if ("done" in next) {
        snap = await commit({ ...base, status: "done" }, [...events, event(snap, "done")]);
        continue;
      }
      events.push(event(snap, "transition", { from: snap.state, to: next.to }));
      if (next.wait) events.push(event(snap, "wait", next.wait));
      const waiting = next.wait ? { status: "waiting" as const, waiting: next.wait } : {};
      snap = await commit({ ...base, state: next.to, ...waiting }, events);
    }
    schedule(snap);
    return snap;
  }

  function schedule(snap: Snap): void {
    const wait = snap.waiting;
    if (!timers || (wait?.kind !== "sleep" && wait?.kind !== "until")) return;
    const due = wait.kind === "sleep" ? Date.parse(snap.updatedAt) + wait.ms : Date.parse(wait.at);
    const fire = (): void => {
      if (Date.now() < due) {
        schedule(snap);
        return;
      }
      resume(snap.runId, undefined, snap.version).catch((error: unknown) => {
        console.error("agenttsm: scheduled resume failed", error);
      });
    };
    setTimeout(fire, Math.min(Math.max(0, due - Date.now()), MAX_TIMER_MS));
  }

  const get = async (runId: string): Promise<Snap | undefined> =>
    (await store.load(runId)) as Snap | undefined;

  async function resume(runId: string, input?: unknown, version?: number): Promise<Snap> {
    const snap = await get(runId);
    if (!snap) throw new AgentTsmError("not_found", `run "${runId}" not found`);
    if (snap.status !== "waiting" || (version ?? snap.version) !== snap.version) return snap;
    const { waiting, ...rest } = snap;
    const ctx = withInput(rest.ctx, input);
    const data = { wait: waiting, ...(input === undefined ? {} : { input }) };
    return drive(await commit({ ...rest, ctx, status: "running" }, [event(snap, "resume", data)]));
  }

  const machine: t.Machine<C, T> = {
    async start(ctx) {
      const at = now();
      const snap: Snap = {
        runId: crypto.randomUUID(),
        version: 0,
        state: def.initial,
        status: "running",
        ctx: withInput(structuredClone(ctx), undefined),
        step: 0,
        attempt: 0,
        usage: { tokens: 0, costUsd: 0 },
        createdAt: at,
        updatedAt: at,
      };
      return drive(await commit(snap, []));
    },
    resume: (runId, input) => resume(runId, input),
    get,
    trace: async (runId) => (await store.trace(runId)) as t.TraceEntry<C>[],
    on(type, listener) {
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set.add(listener));
      return () => {
        set.delete(listener);
      };
    },
    toMermaid: () => toMermaid(def),
    http: (options) => httpHandlers(machine, options),
    async test(ctx, { tools: scripted = tools, llm = def.llm, inputs = [] } = {}) {
      const isolated = build(
        { ...def, store: new MemoryStore(), tools: scripted, ...(llm && { llm }) },
        false,
      );
      const queue = [...inputs];
      let snapshot = await isolated.start(ctx);
      while (snapshot.waiting) {
        const timed = snapshot.waiting.kind === "sleep" || snapshot.waiting.kind === "until";
        if (!timed && queue.length === 0) break;
        snapshot = await isolated.resume(snapshot.runId, timed ? undefined : queue.shift());
      }
      return { snapshot, trace: await isolated.trace(snapshot.runId) };
    },
  };
  return machine;
}

export type Status = "running" | "waiting" | "done" | "failed";

export type Wait =
  | { kind: "human"; prompt?: string }
  | { kind: "webhook"; name: string }
  | { kind: "until"; at: string }
  | { kind: "sleep"; ms: number };

export type Transition<S extends string = string> = S | { to: S; wait?: Wait } | { done: true };

export type RunCtx<C extends object = object> = C & { lastInput?: unknown };

export interface Usage {
  tokens: number;
  costUsd: number;
}

export interface Snapshot<C extends object = object> {
  runId: string;
  version: number;
  state: string;
  status: Status;
  ctx: RunCtx<C>;
  step: number;
  attempt: number;
  waiting?: Wait;
  reason?: string;
  usage: Usage;
  createdAt: string;
  updatedAt: string;
}

export type EventType =
  | "transition"
  | "retry"
  | "wait"
  | "resume"
  | "done"
  | "failed"
  | "route"
  | (string & {});

export interface RunEvent {
  type: EventType;
  runId: string;
  state: string;
  at: string;
  data?: unknown;
}

export type Listener = (event: RunEvent) => void;

export type TraceEntry<C extends object = object> =
  | { kind: "snapshot"; snapshot: Snapshot<C> }
  | { kind: "event"; event: RunEvent };

export interface ListFilter {
  status?: Status;
  state?: string;
}

/**
 * Persistence port. `save` must reject with an `AgentTsmError` of code `"conflict"` unless
 * `snapshot.version` is exactly one more than the stored version (0 when the run is new),
 * and must persist the snapshot and its events atomically.
 */
export interface Store {
  save(snapshot: Snapshot, events: readonly RunEvent[]): Promise<void>;
  load(runId: string): Promise<Snapshot | undefined>;
  list(filter?: ListFilter): Promise<Snapshot[]>;
  trace(runId: string): Promise<TraceEntry[]>;
}

export interface LLMRequest {
  prompt: string;
  system?: string;
  signal?: AbortSignal;
}

export interface LLMResponse {
  text: string;
  tokens?: number;
  costUsd?: number;
}

export interface LLM {
  complete(request: LLMRequest): Promise<LLMResponse>;
}

export interface Step<S extends string, T> {
  signal: AbortSignal;
  attempt: number;
  tools: T;
  llm: LLM;
  emit(type: EventType, data?: unknown): void;
  route<A extends S>(allowed: readonly A[], prompt: string): Promise<{ to: A }>;
}

export interface StateDef<C extends object, S extends string, T> {
  run(ctx: RunCtx<C>, step: Step<S, T>): Transition<S> | Promise<Transition<S>>;
  to?: readonly S[];
  final?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface Guards {
  maxSteps?: number;
  maxTokens?: number;
  budgetUsd?: number;
  deadlineMs?: number;
}

export interface RetryPolicy {
  baseMs?: number;
  maxMs?: number;
}

export interface MachineDef<C extends object, S extends string, T> {
  initial: NoInfer<S>;
  states: { [K in S]: StateDef<C, NoInfer<S>, T> };
  guards?: Guards;
  retry?: RetryPolicy;
  store?: Store;
  tools?: T;
  llm?: LLM;
}

export interface HttpOptions<C extends object> {
  parse?: (body: unknown) => C;
}

export interface HttpHandlers {
  start(request: Request): Promise<Response>;
  get(request: Request, runId?: string): Promise<Response>;
  resume(request: Request, runId?: string): Promise<Response>;
}

export interface TestOptions<T> {
  tools?: T;
  llm?: LLM;
  inputs?: readonly unknown[];
}

export interface TestResult<C extends object> {
  snapshot: Snapshot<C>;
  trace: TraceEntry<C>[];
}

export interface Machine<C extends object, T> {
  start(ctx: C): Promise<Snapshot<C>>;
  resume(runId: string, input?: unknown): Promise<Snapshot<C>>;
  get(runId: string): Promise<Snapshot<C> | undefined>;
  trace(runId: string): Promise<TraceEntry<C>[]>;
  on(type: EventType | "*", listener: Listener): () => void;
  toMermaid(): string;
  http(options?: HttpOptions<C>): HttpHandlers;
  test(ctx: C, options?: TestOptions<T>): Promise<TestResult<C>>;
}

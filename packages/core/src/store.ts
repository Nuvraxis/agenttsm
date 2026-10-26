import { AgentTsmError } from "./errors.ts";
import type { ListFilter, RunEvent, Snapshot, Store, TraceEntry } from "./types.ts";

export class MemoryStore implements Store {
  readonly #runs = new Map<string, Snapshot>();
  readonly #traces = new Map<string, TraceEntry[]>();

  async save(snapshot: Snapshot, events: readonly RunEvent[]): Promise<void> {
    const current = this.#runs.get(snapshot.runId)?.version ?? 0;
    if (snapshot.version !== current + 1) {
      throw new AgentTsmError(
        "conflict",
        `run "${snapshot.runId}" is at version ${current}, not ${snapshot.version - 1}`,
      );
    }
    const copy = structuredClone(snapshot);
    const trace = this.#traces.get(snapshot.runId) ?? [];
    for (const event of events) trace.push({ kind: "event", event: structuredClone(event) });
    trace.push({ kind: "snapshot", snapshot: structuredClone(copy) });
    this.#runs.set(snapshot.runId, copy);
    this.#traces.set(snapshot.runId, trace);
  }

  async load(runId: string): Promise<Snapshot | undefined> {
    const snapshot = this.#runs.get(runId);
    return snapshot && structuredClone(snapshot);
  }

  async list(filter: ListFilter = {}): Promise<Snapshot[]> {
    return [...this.#runs.values()]
      .filter(
        (s) => (filter.status ?? s.status) === s.status && (filter.state ?? s.state) === s.state,
      )
      .map((s) => structuredClone(s));
  }

  async trace(runId: string): Promise<TraceEntry[]> {
    return structuredClone(this.#traces.get(runId) ?? []);
  }
}

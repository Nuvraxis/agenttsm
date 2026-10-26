import { describe, expect, it } from "vitest";
import type { ListFilter, Snapshot } from "../src/index.ts";
import { MemoryStore } from "../src/index.ts";

const snapshot = (runId: string, version: number, patch: Partial<Snapshot> = {}): Snapshot => ({
  runId,
  version,
  state: "a",
  status: "running",
  ctx: {},
  step: 0,
  attempt: 0,
  usage: { tokens: 0, costUsd: 0 },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

describe("MemoryStore", () => {
  it.each([
    { name: "a new run that does not start at version 1", saves: [2] },
    { name: "a stale version", saves: [1, 2, 2] },
    { name: "a skipped version", saves: [1, 3] },
  ])("rejects $name with a conflict", async ({ saves }) => {
    const store = new MemoryStore();
    const last = saves.pop() as number;
    for (const version of saves) await store.save(snapshot("r", version), []);
    await expect(store.save(snapshot("r", last), [])).rejects.toMatchObject({ code: "conflict" });
  });

  it("returns copies so callers cannot mutate stored state", async () => {
    const store = new MemoryStore();
    const original = snapshot("r", 1, { ctx: { n: 1 } as object });
    await store.save(original, [{ type: "x", runId: "r", state: "a", at: "now" }]);
    (original.ctx as { n: number }).n = 2;
    const loaded = await store.load("r");
    (loaded?.ctx as { n: number }).n = 3;
    expect((await store.load("r"))?.ctx).toEqual({ n: 1 });
    expect(await store.trace("r")).toHaveLength(2);
    expect(await store.load("missing")).toBeUndefined();
  });

  it.each<{ filter?: ListFilter; ids: string[] }>([
    { ids: ["a", "b", "c"] },
    { filter: { status: "waiting" }, ids: ["b", "c"] },
    { filter: { state: "x" }, ids: ["c"] },
    { filter: { status: "waiting", state: "a" }, ids: ["b"] },
  ])("lists runs matching $filter", async ({ filter, ids }) => {
    const store = new MemoryStore();
    await store.save(snapshot("a", 1), []);
    await store.save(snapshot("b", 1, { status: "waiting" }), []);
    await store.save(snapshot("c", 1, { status: "waiting", state: "x" }), []);
    expect((await store.list(filter)).map((s) => s.runId)).toEqual(ids);
  });
});

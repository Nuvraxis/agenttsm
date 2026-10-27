import type { RunEvent, Snapshot } from "@nuvraxis-org/agenttsm";
import { AgentTsmError, defineMachine } from "@nuvraxis-org/agenttsm";
import { beforeEach, describe, expect, it } from "vitest";
import { PostgresStore, schemaSql } from "../src/index.ts";
import { url, useTestSchema } from "./db.ts";

type Ctx = Snapshot<Record<string, unknown>>;

const at = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();

function snap(runId: string, version: number, fields: Partial<Ctx> = {}): Ctx {
  return {
    runId,
    version,
    state: "a",
    status: "running",
    ctx: { n: version },
    step: version - 1,
    attempt: 0,
    usage: { tokens: 0, costUsd: 0 },
    createdAt: at(0),
    updatedAt: at(version),
    ...fields,
  };
}

const event = (runId: string, type: RunEvent["type"]): RunEvent => ({
  type,
  runId,
  state: "a",
  at: at(0),
});

describe("schemaSql", () => {
  it("quotes the default and schema-qualified table names", () => {
    expect(schemaSql().join("\n")).toContain('"agenttsm_runs"');
    const sql = schemaSql("jobs.refunds").join("\n");
    expect(sql).toContain('"jobs"."refunds_runs"');
    expect(sql).toContain('REFERENCES "jobs"."refunds_runs" (run_id)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "refunds_runs_status_state_idx"');
  });

  it.each(["Runs", "a.b.c", "x; DROP TABLE y", "", "1abc", `${"a".repeat(42)}`])(
    "rejects the table name %j",
    (table) => {
      expect(() => schemaSql(table)).toThrow(AgentTsmError);
      expect(
        () =>
          new PostgresStore({ pool: { query: async () => ({ rows: [], rowCount: 0 }) }, table }),
      ).toThrow("must be a lowercase SQL identifier");
    },
  );
});

describe.skipIf(!url)("PostgresStore", () => {
  const db = useTestSchema();
  let store: PostgresStore;

  beforeEach(async () => {
    store = await db.store();
    await db.reset();
  });

  it("migrates idempotently", async () => {
    await store.migrate();
    const { rows } = await db.pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1",
      [db.schema],
    );
    expect(rows).toEqual([{ table_name: "agenttsm_runs" }, { table_name: "agenttsm_trace" }]);
  });

  it("saves, loads and traces events before each snapshot, in order", async () => {
    await store.save(snap("r1", 1), []);
    await store.save(snap("r1", 2, { status: "waiting" }), [
      event("r1", "transition"),
      event("r1", "wait"),
    ]);
    await store.save(snap("r1", 3, { status: "done" }), [event("r1", "done")]);

    expect(await store.load("r1")).toEqual(snap("r1", 3, { status: "done" }));
    expect(
      (await store.trace("r1")).map((e) =>
        e.kind === "event" ? e.event.type : e.snapshot.version,
      ),
    ).toEqual([1, "transition", "wait", 2, "done", 3]);
  });

  it("returns undefined and an empty trace for an unknown run", async () => {
    expect(await store.load("missing")).toBeUndefined();
    expect(await store.trace("missing")).toEqual([]);
  });

  it.each([
    {
      name: "a new run that does not start at version 1",
      setup: [],
      save: 2,
      message: "at version 0, not 1",
    },
    { name: "a skipped version", setup: [1], save: 3, message: "at version 1, not 2" },
    { name: "a stale version", setup: [1, 2], save: 2, message: "at version 2, not 1" },
    { name: "a second version 1", setup: [1], save: 1, message: "at version 1, not 0" },
  ])("rejects $name with a conflict and writes nothing", async ({ setup, save, message }) => {
    for (const version of setup) await store.save(snap("r1", version), []);
    const before = await store.trace("r1");
    const error = await store
      .save(snap("r1", save), [event("r1", "done")])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AgentTsmError);
    expect(error).toMatchObject({ code: "conflict", message: expect.stringContaining(message) });
    expect(await store.trace("r1")).toEqual(before);
  });

  it.each([
    { name: "creates", setup: [], version: 1 },
    { name: "updates", setup: [1], version: 2 },
  ])("lets exactly one of several concurrent $name win", async ({ setup, version }) => {
    for (const v of setup) await store.save(snap("r1", v), []);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        store.save(snap("r1", version, { ctx: { writer: i } }), []),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      results.filter(
        (r) => r.status === "rejected" && (r.reason as AgentTsmError).code === "conflict",
      ),
    ).toHaveLength(7);
    expect((await store.trace("r1")).filter((e) => e.kind === "snapshot")).toHaveLength(version);
  });

  it("lists runs by status and state, oldest first", async () => {
    await store.save(snap("r2", 1, { createdAt: at(2), status: "waiting", state: "b" }), []);
    await store.save(snap("r1", 1, { createdAt: at(1), status: "waiting", state: "a" }), []);
    await store.save(snap("r3", 1, { createdAt: at(3), status: "done", state: "b" }), []);
    const ids = (snapshots: Snapshot[]) => snapshots.map((s) => s.runId);

    expect(ids(await store.list())).toEqual(["r1", "r2", "r3"]);
    expect(ids(await store.list({ status: "waiting" }))).toEqual(["r1", "r2"]);
    expect(ids(await store.list({ state: "b" }))).toEqual(["r2", "r3"]);
    expect(ids(await store.list({ status: "waiting", state: "b" }))).toEqual(["r2"]);
  });

  it("stores ctx as JSON", async () => {
    await store.save(
      snap("r1", 1, { ctx: { when: new Date(at(5)), gone: undefined, text: "é ✓" } }),
      [],
    );
    expect((await store.load("r1"))?.ctx).toEqual({ when: at(5), text: "é ✓" });
  });

  it("keeps machines on separate tables apart", async () => {
    const other = new PostgresStore({ pool: db.pool, table: `${db.schema}.other` });
    await other.migrate();
    await store.save(snap("r1", 1), []);
    expect(await other.load("r1")).toBeUndefined();
    expect(await other.list()).toEqual([]);
  });

  it("runs a machine across a restart and polls its timed wait", async () => {
    const def = {
      initial: "draft",
      timers: false,
      store,
      states: {
        draft: {
          to: ["send"],
          run: () => ({ to: "send", wait: { kind: "sleep", ms: 0 } }) as const,
        },
        send: { run: () => ({ done: true }) as const },
      },
    } as const;
    const started = await defineMachine(def).start({});
    expect(started.status).toBe("waiting");

    const restarted = defineMachine({
      ...def,
      store: new PostgresStore({ pool: db.pool, table: db.table }),
    });
    expect((await restarted.poll()).map((s) => s.runId)).toEqual([started.runId]);
    expect(await restarted.get(started.runId)).toMatchObject({ status: "done", step: 2 });
    expect(await restarted.poll()).toEqual([]);
  });
});

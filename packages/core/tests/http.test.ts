import { describe, expect, it, vi } from "vitest";
import { httpHandlers } from "../src/http.ts";
import type { HttpAccess, HttpHandlers, Snapshot } from "../src/index.ts";
import { AgentTsmError, defineMachine } from "../src/index.ts";

const open = { authorize: () => true };

const machine = () =>
  defineMachine({
    initial: "ask",
    states: {
      ask: { to: ["go"], run: () => ({ to: "go", wait: { kind: "human" } }) },
      go: { run: () => ({ done: true }) },
    },
  });

const post = (path: string, body?: string) =>
  new Request(`http://test${path}`, { method: "POST", ...(body === undefined ? {} : { body }) });

describe("http()", () => {
  it("starts, reads and resumes a run", async () => {
    const http = machine().http(open);
    const started = await http.start(post("/runs", JSON.stringify({ user: "sajan" })));
    expect(started.status).toBe(201);
    const snap = (await started.json()) as Snapshot;
    expect(snap).toMatchObject({ status: "waiting", ctx: { user: "sajan" } });

    const read = await http.get(new Request(`http://test/api/runs/${snap.runId}`));
    expect(read.status).toBe(200);

    const resumed = await http.resume(
      post(`/runs/${snap.runId}/resume`, JSON.stringify({ input: "ok" })),
    );
    expect(await resumed.json()).toMatchObject({ status: "done", ctx: { lastInput: "ok" } });

    const again = await http.resume(post("/ignored"), snap.runId);
    expect(await again.json()).toMatchObject({ status: "done" });
  });

  it("starts with an empty ctx when the body is empty", async () => {
    const response = await machine().http(open).start(post("/runs"));
    expect(response.status).toBe(201);
  });

  it.each([
    { name: "invalid JSON", body: "{", status: 400, error: "not valid JSON" },
    { name: "non-object body", body: "[1]", status: 400, error: "must be a JSON object" },
  ])("start rejects $name", async ({ body, status, error }) => {
    const response = await machine().http(open).start(post("/runs", body));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining(error) });
  });

  it("uses a custom parser and reports its errors", async () => {
    const http = machine().http({
      ...open,
      parse: (body) => {
        throw `bad ${JSON.stringify(body)}`;
      },
    });
    const response = await http.start(post("/runs", "{}"));
    expect(await response.json()).toEqual({ error: "bad {}" });
  });

  it.each<{ name: string; call: (h: HttpHandlers) => Promise<Response>; status: number }>([
    {
      name: "get of an unknown run",
      call: (h) => h.get(new Request("http://test/runs/x")),
      status: 404,
    },
    {
      name: "resume of an unknown run",
      call: (h) => h.resume(post("/runs/x/resume")),
      status: 404,
    },
    {
      name: "resume with invalid JSON",
      call: (h) => h.resume(post("/runs/x/resume", "{")),
      status: 400,
    },
  ])("$name returns $status", async ({ call, status }) => {
    expect((await call(machine().http(open))).status).toBe(status);
  });

  it("maps a conflict from resume to 409", async () => {
    const reject = () => Promise.reject(new AgentTsmError("conflict", "busy"));
    const handlers = httpHandlers({ ...machine(), resume: reject }, open);
    expect((await handlers.resume(post("/runs/x/resume"))).status).toBe(409);
  });

  it.each([
    { name: "other library errors", error: new AgentTsmError("definition", "bad def") },
    { name: "non-library errors", error: new Error("db down") },
  ])("rethrows $name from resume", async ({ error }) => {
    const handlers = httpHandlers({ ...machine(), resume: () => Promise.reject(error) }, open);
    await expect(handlers.resume(post("/runs/x/resume"))).rejects.toBe(error);
  });
});

describe("http() authorization", () => {
  const get = (runId: string) => new Request(`http://test/runs/${runId}`);

  it("refuses to build handlers without authorize", () => {
    // @ts-expect-error authorize is required
    expect(() => machine().http()).toThrow("needs an authorize function");
    // @ts-expect-error authorize is required
    expect(() => machine().http({})).toThrow(AgentTsmError);
  });

  it.each([
    { name: "false", verdict: false },
    { name: "a truthy non-boolean", verdict: "yes" as unknown as boolean },
  ])("answers 403 when authorize returns $name", async ({ verdict }) => {
    const http = machine().http({ authorize: () => verdict });
    for (const response of [
      await http.start(post("/runs")),
      await http.get(get("x")),
      await http.resume(post("/runs/x/resume")),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
  });

  it("returns a Response from authorize as it is", async () => {
    const http = machine().http({ authorize: async () => new Response(null, { status: 401 }) });
    expect((await http.get(get("x"))).status).toBe(401);
  });

  it("passes the ctx, run id and stored snapshot to authorize", async () => {
    const seen: HttpAccess<Record<string, unknown>>[] = [];
    const http = machine().http({
      authorize: (_request, access) => {
        seen.push(structuredClone(access));
        return true;
      },
    });
    const snap = (await (await http.start(post("/runs", '{"owner":"a"}'))).json()) as Snapshot;
    await http.get(get(snap.runId));
    await http.resume(post(`/runs/${snap.runId}/resume`, '{"input":1}'));
    expect((await http.get(get("missing"))).status).toBe(404);
    expect(seen).toMatchObject([
      { action: "start", ctx: { owner: "a" } },
      { action: "get", runId: snap.runId, snapshot: { status: "waiting" } },
      { action: "resume", runId: snap.runId, snapshot: { status: "waiting" } },
      { action: "get", runId: "missing", snapshot: undefined },
    ]);
  });

  it("neither starts nor resumes a run it denies", async () => {
    let allow = true;
    const m = machine();
    const http = m.http({ authorize: () => allow });
    const snap = (await (await http.start(post("/runs"))).json()) as Snapshot;
    allow = false;
    await http.resume(post(`/runs/${snap.runId}/resume`, '{"input":"ok"}'));
    expect(await m.get(snap.runId)).toMatchObject({ status: "waiting" });

    const start = vi.fn();
    await httpHandlers({ ...m, start }, { authorize: () => false }).start(post("/runs"));
    expect(start).not.toHaveBeenCalled();
  });

  it("ignores lastInput in the start body", async () => {
    const http = machine().http(open);
    const body = JSON.stringify({ lastInput: "approved" });
    const snap = (await (await http.start(post("/runs", body))).json()) as Snapshot;
    expect(snap.ctx).not.toHaveProperty("lastInput");
  });
});

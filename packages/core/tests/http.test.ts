import { describe, expect, it } from "vitest";
import { httpHandlers } from "../src/http.ts";
import type { HttpHandlers, Snapshot } from "../src/index.ts";
import { AgentTsmError, defineMachine } from "../src/index.ts";

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
    const http = machine().http();
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
    const response = await machine().http().start(post("/runs"));
    expect(response.status).toBe(201);
  });

  it.each([
    { name: "invalid JSON", body: "{", status: 400, error: "not valid JSON" },
    { name: "non-object body", body: "[1]", status: 400, error: "must be a JSON object" },
  ])("start rejects $name", async ({ body, status, error }) => {
    const response = await machine().http().start(post("/runs", body));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining(error) });
  });

  it("uses a custom parser and reports its errors", async () => {
    const http = machine().http({
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
    expect((await call(machine().http())).status).toBe(status);
  });

  it("maps a conflict from resume to 409", async () => {
    const reject = () => Promise.reject(new AgentTsmError("conflict", "busy"));
    const handlers = httpHandlers({ ...machine(), resume: reject });
    expect((await handlers.resume(post("/runs/x/resume"))).status).toBe(409);
  });

  it.each([
    { name: "other library errors", error: new AgentTsmError("definition", "bad def") },
    { name: "non-library errors", error: new Error("db down") },
  ])("rethrows $name from resume", async ({ error }) => {
    const handlers = httpHandlers({ ...machine(), resume: () => Promise.reject(error) });
    await expect(handlers.resume(post("/runs/x/resume"))).rejects.toBe(error);
  });
});

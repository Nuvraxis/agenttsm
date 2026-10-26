import type { Snapshot } from "@nuvraxis-org/agenttsm";
import { POST as resumeRun } from "../app/api/runs/[id]/resume/route.ts";
import { GET as getRun } from "../app/api/runs/[id]/route.ts";
import { POST as startRun } from "../app/api/runs/route.ts";
import type { Ctx } from "../lib/machine.ts";

const base = "http://localhost:3000/api/runs";
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function show(label: string, response: Promise<Response>): Promise<Snapshot<Ctx>> {
  const res = await response;
  const snapshot = (await res.json()) as Snapshot<Ctx>;
  console.log(`${label} -> ${res.status} ${snapshot.status} (state: ${snapshot.state})`);
  return snapshot;
}

const body = { orderId: "A-1001", reason: "arrived damaged", recommendation: "", decision: "" };
const started = await show(
  "POST /api/runs",
  startRun(new Request(base, { method: "POST", body: JSON.stringify(body) })),
);
console.log(`  recommendation: ${started.ctx.recommendation}`);

const id = started.runId;
await show(`GET /api/runs/${id}`, getRun(new Request(`${base}/${id}`), params(id)));

const finished = await show(
  `POST /api/runs/${id}/resume`,
  resumeRun(
    new Request(`${base}/${id}/resume`, {
      method: "POST",
      body: JSON.stringify({ input: "approve" }),
    }),
    params(id),
  ),
);
console.log(`  decision: ${finished.ctx.decision}`);

if (finished.status !== "done" || finished.ctx.decision !== "refunded") process.exitCode = 1;

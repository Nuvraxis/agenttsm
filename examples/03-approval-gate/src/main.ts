import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { Snapshot } from "@nuvraxis-org/agenttsm";
import { honoRoutes } from "./hono.ts";
import { type Ctx, machine } from "./machine.ts";

const app = honoRoutes(machine.http());
const keepServing = process.env.SERVE === "1";
const port = keepServing ? Number(process.env.PORT ?? 3000) : 0;

const server = serve({ fetch: app.fetch, port }, async (info: AddressInfo) => {
  const base = `http://localhost:${info.port}`;
  if (keepServing) {
    console.log(`listening on ${base}`);
    console.log(
      `  curl -X POST ${base}/runs -d '{"customer":"Sajan","amountUsd":42,"email":"","sent":false}'`,
    );
    console.log(`  curl ${base}/runs/<id>`);
    console.log(`  curl -X POST ${base}/runs/<id>/resume -d '{"input":{"approved":true}}'`);
    return;
  }

  const call = async (method: string, path: string, body?: unknown): Promise<Snapshot<Ctx>> => {
    const response = await fetch(`${base}${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const snapshot = (await response.json()) as Snapshot<Ctx>;
    console.log(
      `${method} ${path} -> ${response.status} ${snapshot.status} (state: ${snapshot.state})`,
    );
    return snapshot;
  };

  const started = await call("POST", "/runs", {
    customer: "Sajan",
    amountUsd: 42,
    email: "",
    sent: false,
  });
  console.log(`  waiting for: ${JSON.stringify(started.waiting)}`);
  console.log(`  draft: ${started.ctx.email}`);
  await call("GET", `/runs/${started.runId}`);
  const finished = await call("POST", `/runs/${started.runId}/resume`, {
    input: { approved: true },
  });
  console.log(`  sent: ${finished.ctx.sent}`);

  if (finished.status !== "done" || !finished.ctx.sent) process.exitCode = 1;
  server.close();
});

import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { Snapshot } from "@nuvraxis-org/agenttsm";
import { authorize, type Role, tokens } from "./auth.ts";
import { honoRoutes } from "./hono.ts";
import { type Ctx, machine } from "./machine.ts";

const app = honoRoutes(machine.http({ authorize }));
const keepServing = process.env.SERVE === "1";
const port = keepServing ? Number(process.env.PORT ?? 3000) : 0;

const server = serve({ fetch: app.fetch, port }, async (info: AddressInfo) => {
  const base = `http://localhost:${info.port}`;
  if (keepServing) {
    const auth = (role: Role) => `-H 'authorization: Bearer ${tokens[role]}'`;
    console.log(`listening on ${base}`);
    console.log(
      `  curl ${auth("requester")} -X POST ${base}/runs -d '{"customer":"Sajan","amountUsd":42,"email":"","sent":false}'`,
    );
    console.log(`  curl ${auth("requester")} ${base}/runs/<id>`);
    console.log(
      `  curl ${auth("reviewer")} -X POST ${base}/runs/<id>/resume -d '{"input":{"approved":true}}'`,
    );
    return;
  }

  type Result = Snapshot<Ctx> & { error?: string };
  const call = async (role: Role, method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${tokens[role]}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = (await response.json()) as Result;
    const outcome = result.error ?? `${result.status} (state: ${result.state})`;
    console.log(`${role.padEnd(9)} ${method} ${path} -> ${response.status} ${outcome}`);
    return { status: response.status, result };
  };

  const { result: started } = await call("requester", "POST", "/runs", {
    customer: "Sajan",
    amountUsd: 42,
    email: "",
    sent: false,
  });
  console.log(`  waiting for: ${JSON.stringify(started.waiting)}`);
  console.log(`  draft: ${started.ctx.email}`);
  await call("requester", "GET", `/runs/${started.runId}`);
  const approval = { input: { approved: true } };
  const selfApproval = await call("requester", "POST", `/runs/${started.runId}/resume`, approval);
  const { result: finished } = await call(
    "reviewer",
    "POST",
    `/runs/${started.runId}/resume`,
    approval,
  );
  console.log(`  sent: ${finished.ctx.sent}`);

  if (selfApproval.status !== 403 || finished.status !== "done" || !finished.ctx.sent) {
    process.exitCode = 1;
  }
  server.close();
});

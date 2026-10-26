import { AgentTsmError } from "./errors.ts";
import type { HttpHandlers, HttpOptions, Machine } from "./types.ts";

type Body = { ok: true; value: unknown } | { ok: false; response: Response };

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function runIdOf(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  if (parts.at(-1) === "resume") parts.pop();
  return decodeURIComponent(parts.at(-1) ?? "");
}

async function read(request: Request): Promise<Body> {
  const text = await request.text();
  try {
    return { ok: true, value: text ? JSON.parse(text) : undefined };
  } catch {
    return { ok: false, response: json({ error: "request body is not valid JSON" }, 400) };
  }
}

function defaultParse<C extends object>(body: unknown): C {
  if (!isRecord(body)) throw new Error("request body must be a JSON object");
  return body as C;
}

export function httpHandlers<C extends object>(
  machine: Pick<Machine<C, unknown>, "start" | "get" | "resume">,
  { parse = defaultParse }: HttpOptions<C> = {},
): HttpHandlers {
  return {
    async start(request) {
      const body = await read(request);
      if (!body.ok) return body.response;
      let ctx: C;
      try {
        ctx = parse(body.value ?? {});
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
      return json(await machine.start(ctx), 201);
    },

    async get(request, runId = runIdOf(request)) {
      const snapshot = await machine.get(runId);
      return snapshot ? json(snapshot) : json({ error: `run "${runId}" not found` }, 404);
    },

    async resume(request, runId = runIdOf(request)) {
      const body = await read(request);
      if (!body.ok) return body.response;
      try {
        return json(
          await machine.resume(runId, isRecord(body.value) ? body.value.input : undefined),
        );
      } catch (error) {
        if (!(error instanceof AgentTsmError)) throw error;
        if (error.code === "not_found") return json({ error: error.message }, 404);
        if (error.code === "conflict") return json({ error: error.message }, 409);
        throw error;
      }
    },
  };
}

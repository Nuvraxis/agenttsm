import { randomUUID } from "node:crypto";
import type { HttpAccess } from "@nuvraxis-org/agenttsm";
import { bearerToken, sameSecret } from "examples-shared";
import type { Ctx } from "./machine.ts";

// Stand-in for a real session check: one bearer token per role.
export const tokens = {
  requester: process.env.REQUESTER_TOKEN ?? randomUUID(),
  reviewer: process.env.REVIEWER_TOKEN ?? randomUUID(),
};

export type Role = keyof typeof tokens;

export function authorize(request: Request, { action }: HttpAccess<Ctx>): boolean | Response {
  const token = bearerToken(request);
  if (!token) return Response.json({ error: "missing bearer token" }, { status: 401 });
  if (sameSecret(token, tokens.reviewer)) return true;
  return sameSecret(token, tokens.requester) && action !== "resume";
}

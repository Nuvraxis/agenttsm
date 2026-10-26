import type { HttpHandlers } from "@nuvraxis-org/agenttsm";
import { Hono } from "hono";

export function honoRoutes(http: HttpHandlers): Hono {
  return new Hono()
    .post("/runs", (c) => http.start(c.req.raw))
    .get("/runs/:id", (c) => http.get(c.req.raw, c.req.param("id")))
    .post("/runs/:id/resume", (c) => http.resume(c.req.raw, c.req.param("id")));
}

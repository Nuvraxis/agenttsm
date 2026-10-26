---
"@nuvraxis-org/agenttsm": minor
---

Breaking: `http()` now requires an `authorize` function and throws without one. It runs before every start, read and resume, and receives `{ action: "start", ctx }` or `{ action: "get" | "resume", runId, snapshot }`. Return `true` to allow, anything else for `403`, or a `Response` to send as it is. To keep the old behaviour for a public endpoint, pass `http({ authorize: () => true })`.

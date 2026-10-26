# @nuvraxis-org/agenttsm

## 0.2.0

### Minor Changes

- 575f785: Breaking: `http()` now requires an `authorize` function and throws without one. It runs before every start, read and resume, and receives `{ action: "start", ctx }` or `{ action: "get" | "resume", runId, snapshot }`. Return `true` to allow, anything else for `403`, or a `Response` to send as it is. To keep the old behaviour for a public endpoint, pass `http({ authorize: () => true })`.
- 575f785: `ctx.lastInput` now holds only the input of the latest resume. `start()` drops a `lastInput` passed in its ctx, so a caller can no longer pre-seed an approval, and a resume without input (including a timed `sleep` or `until` resume) removes the previous value instead of keeping it.

## 0.1.0

### Minor Changes

- c516594: First release: `defineMachine()` with per-step snapshots, retries with backoff, per-state timeouts, guards, human/webhook/until/sleep waits, optimistic concurrency, events, `toMermaid()`, `http()`, `test()`, and the `/testing` subpath with `FakeLLM` and `fakeTools()`.

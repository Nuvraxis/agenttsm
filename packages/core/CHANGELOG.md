# @nuvraxis-org/agenttsm

## 0.3.0

### Minor Changes

- 8067a3a: Add `step.llm.completeJson({ prompt, system?, parse })`. It calls the model, parses the reply as JSON (accepting a surrounding ```` ```json ```` fence) and runs `parse`, which can be any `(value: unknown) => T` such as a valibot or zod schema. Output that isn't JSON or that `parse` rejects throws `AgentTsmError` with the new code `"invalid_output"`, so the state's `maxRetries` retries it. `AgentTsmError` now accepts an `ErrorOptions` argument and carries the original error as `cause`.
- a509e42: Add `machine.poll()`, which resumes every `sleep` and `until` wait in the store that is due and returns the resumed snapshots. Call it from a cron job or an interval so timed waits come back after a restart or on serverless hosts. Concurrent pollers are safe: the version check lets one of them resume each run. A new `timers: false` option on `defineMachine` turns off the in-process timers for deployments that rely on `poll()` alone.

## 0.2.0

### Minor Changes

- 575f785: Breaking: `http()` now requires an `authorize` function and throws without one. It runs before every start, read and resume, and receives `{ action: "start", ctx }` or `{ action: "get" | "resume", runId, snapshot }`. Return `true` to allow, anything else for `403`, or a `Response` to send as it is. To keep the old behaviour for a public endpoint, pass `http({ authorize: () => true })`.
- 575f785: `ctx.lastInput` now holds only the input of the latest resume. `start()` drops a `lastInput` passed in its ctx, so a caller can no longer pre-seed an approval, and a resume without input (including a timed `sleep` or `until` resume) removes the previous value instead of keeping it.

## 0.1.0

### Minor Changes

- c516594: First release: `defineMachine()` with per-step snapshots, retries with backoff, per-state timeouts, guards, human/webhook/until/sleep waits, optimistic concurrency, events, `toMermaid()`, `http()`, `test()`, and the `/testing` subpath with `FakeLLM` and `fakeTools()`.

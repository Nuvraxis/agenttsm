# Conformance scenarios

Each `*.json` file in this folder describes one machine, scripted LLM and tool answers, a list of
operations, and the result every agenttsm implementation must produce. The TypeScript runner is
[`packages/core/tests/conformance.test.ts`](../packages/core/tests/conformance.test.ts). A port to
another language passes when its runner gets the same results from the same files.

The format uses plain JSON values and no TypeScript-specific features.

## File format

```jsonc
{
  "name": "human-readable description",
  "rules": [1, 4], // runtime rules from the spec this scenario exercises
  "machine": {
    "initial": "a",
    "guards": { "maxSteps": 3 }, // optional: maxSteps, maxTokens, budgetUsd, deadlineMs
    "retry": { "baseMs": 0, "maxMs": 0 }, // optional backoff policy
    "states": {
      "a": {
        "to": ["b"], // declared targets
        "final": false, // optional: may finish even though it has targets
        "maxRetries": 1, // optional
        "timeoutMs": 20, // optional
        "do": [
          /* actions, run in order */
        ],
        "then": "b" // transition returned after the actions; default { "done": true }
      }
    }
  },
  "tools": { "search": [{ "value": 42 }, { "error": "boom" }, { "value": 1, "delayMs": 50 }] },
  "llm": [{ "text": "answer", "tokens": 10, "costUsd": 0.01 }],
  "ctx": {}, // ctx passed to start()
  "ops": [
    /* operations after start() */
  ],
  "expect": {
    /* assertions on the final snapshot and trace */
  }
}
```

### Actions (`do`)

| Action                                   | Effect                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `{ "count": "k" }`                       | `ctx.k = (ctx.k ?? 0) + 1`                                                                                                                |
| `{ "copyInput": "k" }`                   | `ctx.k = ctx.lastInput`, or `null` when there is none                                                                                     |
| `{ "tool": "name", "as": "k" }`          | `ctx.k = await tools.name(ctx)`                                                                                                           |
| `{ "llm": "prompt", "as": "k" }`         | `ctx.k = (await step.llm.complete({ prompt })).text`                                                                                      |
| `{ "llmJson": "prompt", "as": "k" }`     | `ctx.k = await step.llm.completeJson({ prompt, parse })`, where `parse` throws unless the value is a JSON object (not an array or `null`) |
| `{ "emit": "type", "data": x }`          | `step.emit(type, data)`                                                                                                                   |
| `{ "delay": ms }`                        | wait `ms` milliseconds without observing `step.signal`                                                                                    |
| `{ "route": ["a", "b"], "prompt": "p" }` | return `await step.route(["a", "b"], "p")`; ends the action list                                                                          |

`transition` values use the library's shapes: `"name"`, `{ "to": "name" }`,
`{ "to": "name", "wait": { "kind": "human" | "webhook" | "until" | "sleep", ... } }` or
`{ "done": true }`.

### Scripts

- `tools.<name>` is the ordered list of results for that tool. Each entry returns `value` or throws
  `Error(error)`, optionally after `delayMs`. Calling a tool past the end of its script throws.
- `llm` is the ordered list of LLM responses. Each call takes the next entry; running out throws.

### Operations (`ops`)

| Operation                                                              | Meaning                                                                                  |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `{ "check": { ...partial snapshot } }`                                 | The current snapshot matches.                                                            |
| `{ "waitFor": { ...partial snapshot } }`                               | Poll `get(runId)` until it matches; timed waits resume themselves.                       |
| `{ "resume": { "input": x } }`                                         | `resume(runId, x)`. Add `"noop": true` to assert the result equals the current snapshot. |
| `{ "resumeConcurrently": { "count": n, "input": x }, "conflicts": c }` | Start `n` resumes at once; exactly `c` reject with a `conflict` error.                   |

### Expectations (`expect`)

| Key                                                                                  | Assertion                                                                                                            |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `defineError`                                                                        | `defineMachine()` throws an error whose message contains this text; nothing else runs.                               |
| any snapshot field (`status`, `state`, `step`, `attempt`, `ctx`, `usage`, `waiting`) | Partial deep match on the final snapshot.                                                                            |
| `reasonContains`                                                                     | `snapshot.reason` contains this text.                                                                                |
| `events`                                                                             | The trace's events, in order, match this list one-to-one (each entry is a partial match on `type`, `state`, `data`). |
| `snapshots`                                                                          | The trace's snapshots, in order, match this list one-to-one (partial match).                                         |
| `toolCalls`                                                                          | `{ name: n }`: the tool was called `n` times.                                                                        |
| `llmCalls`                                                                           | The LLM was called this many times.                                                                                  |

"Partial match" means every key in the expected object must be present and equal in the actual
value; extra keys in the actual value are ignored. Arrays must have the same length.

## Rules covered

| Rule                                                                                                       | Scenarios                                      |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1. Snapshot saved after every step                                                                         | 01, 02, 05                                     |
| 2. Retries with backoff, attempt in snapshot                                                               | 02, 03, 04, 13, 15                             |
| 3. Per-state timeout via `AbortSignal`                                                                     | 04                                             |
| 4. `wait` transitions, single resume path, no-op resume                                                    | 05, 06, 07                                     |
| 5. Guards checked before every step                                                                        | 08, 09                                         |
| 6. Events                                                                                                  | 01, 02, 03, 05, 12                             |
| 7. Zero runtime dependencies                                                                               | checked by `packages/core/tests/smoke.test.ts` |
| 8. Unknown targets fail at definition time                                                                 | 10                                             |
| 9. Optimistic concurrency on resume                                                                        | 11                                             |
| 10. Only the latest resume sets `ctx.lastInput`                                                            | 14                                             |
| 11. `completeJson` output that is not JSON, or that `parse` rejects, is a retryable `invalid_output` error | 15, 16                                         |

## Adding a scenario

Name it `NN-short-name.json` with the next number, list the rules it covers, and run
`pnpm --filter @nuvraxis-org/agenttsm test`. The runner loads every file in this folder.

# 04 · Retries, timeouts and guards

Three small machines, each showing one failure path.

```sh
pnpm --filter 04-retry-timeout start
```

```text
[flaky tool] retry      fetchPrice {"attempt":1,"delayMs":38,"error":"503 upstream unavailable"}
[flaky tool] retry      fetchPrice {"attempt":2,"delayMs":94,"error":"503 upstream unavailable"}
[flaky tool] transition fetchPrice {"from":"fetchPrice","to":"summarize"}
[flaky tool] done       summarize {}
-> done: ACME trades at $101.50.

[timeout] retry      lookup {"attempt":1,"delayMs":10,"error":"timeout: state \"lookup\" exceeded 100ms"}
[timeout] done       lookup {}
-> done: answered after 20ms

[guard] failed     poll {"reason":"maxSteps guard breached: 6 > 5"}
-> failed after 5 polls: maxSteps guard breached: 6 > 5
```

Retry delays are jittered, so the numbers change between runs.

## What it shows

| Machine    | Feature                                                                                                                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| flaky tool | `maxRetries: 3` with exponential backoff and jitter (`retry: { baseMs, maxMs }`). The attempt count is stored in the snapshot, and ctx changes from failed attempts are discarded. The tool comes from `fakeTools()` in `@nuvraxis-org/agenttsm/testing`. |
| timeout    | `timeoutMs: 100` aborts `step.signal`. The lookup listens to the signal and stops; the attempt counts as a failure and is retried.                                                                                                                        |
| guard      | `guards: { maxSteps: 5 }` is checked before every step. The sixth step is refused and the run ends `failed`, with the reason in `snapshot.reason`.                                                                                                        |

Guards also cover `maxTokens`, `budgetUsd` and `deadlineMs`; see example 05 for a budget.

## Real model

```sh
LLM=anthropic ANTHROPIC_API_KEY=... pnpm --filter 04-retry-timeout start
```

Only the `summarize` step calls the model.

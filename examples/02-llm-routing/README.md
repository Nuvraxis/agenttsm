# 02 · LLM routing

A support ticket is triaged by `step.route()`, which asks the LLM to pick one of the allowed next
states. The scripted first answer is invalid, so `route()` asks again once.

```sh
pnpm --filter 02-llm-routing start
```

```text
route attempt 1: "Hmm, this sounds like a billing thing?" -> invalid, asking again
route attempt 2: "billing" -> billing
transition triage -> billing

done: [billing] Sorry about the double charge, a refund for the second payment is on its way.
```

## What it shows

- `step.route(["billing", "technical", "sales"], prompt)` appends the list of valid answers to the
  prompt, matches the reply case-insensitively (ignoring quotes and trailing punctuation), and
  returns `{ to }`.
- On an invalid reply it retries once with the previous answer quoted back. A second invalid reply
  throws, which counts as a failed attempt for the state's `maxRetries`.
- Every attempt is recorded as a `route` event, with the raw answer and the chosen target (or
  `null`).
- The allowed targets are type-checked against the state's `to` list.

## Real model

```sh
LLM=anthropic ANTHROPIC_API_KEY=... pnpm --filter 02-llm-routing start
```

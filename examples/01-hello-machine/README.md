# 01 · Hello machine

Three states, one LLM call, and a listener that prints every transition.

```sh
pnpm --filter 01-hello-machine start
```

```text
transition  greet -> shout
transition  shout -> sign
done        in state sign

status: done, steps: 3
greeting: HELLO, SAJAN! WELCOME ABOARD. (sent by agenttsm)
```

## What it shows

- `defineMachine({ initial, states })` runs as soon as it is defined, using the in-memory store.
- Each state declares its targets in `to`. A state with no `to` may only finish with `{ done: true }`.
- Handlers mutate `ctx`. The runtime saves the new ctx in a snapshot after each step.
- `machine.on("transition", fn)` receives a `RunEvent` with `{ from, to }` in `data`.

## Real model

```sh
LLM=anthropic ANTHROPIC_API_KEY=... pnpm --filter 01-hello-machine start
```

The example uses `FakeLLM` from `@nuvraxis-org/agenttsm/testing` by default. `LLM=anthropic` swaps in
the Anthropic SDK adapter from [`examples/shared`](../shared/src/index.ts). The SDK is a dependency
of the examples only, never of the core package.

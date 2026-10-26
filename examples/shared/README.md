# examples-shared

The LLM helper the examples share. It's a private workspace package, not an example.
- `pickLLM(script)` returns a `FakeLLM` that plays `script`, or the Anthropic adapter when
  `LLM=anthropic` is set.
- `anthropicLLM()` adapts `@anthropic-ai/sdk` to the core `LLM` port. It calls `claude-opus-5-5`
  with server-side refusal fallbacks enabled, passes `step.signal` through so state timeouts cancel
  the request, and reports `tokens` and `costUsd` so guards can meter real usage.

Credentials come from the SDK's usual sources, for example `ANTHROPIC_API_KEY`.

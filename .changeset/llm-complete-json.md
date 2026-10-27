---
"@nuvraxis-org/agenttsm": minor
---

Add `step.llm.completeJson({ prompt, system?, parse })`. It calls the model, parses the reply as JSON (accepting a surrounding ```` ```json ```` fence) and runs `parse`, which can be any `(value: unknown) => T` such as a valibot or zod schema. Output that isn't JSON or that `parse` rejects throws `AgentTsmError` with the new code `"invalid_output"`, so the state's `maxRetries` retries it. `AgentTsmError` now accepts an `ErrorOptions` argument and carries the original error as `cause`.

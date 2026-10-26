# 06 · Multi-agent handoff

Each state is an agent with its own system prompt and tools: a researcher, a writer, a critic, and
a publisher that formats the result. They share one `ctx`, and handoffs are ordinary transitions.
The critic uses `step.route()` to send the draft back to the writer or forward to the publisher.

```sh
pnpm --filter 06-multi-agent start
```

```text
researcher -> writer     (searchDocs)
writer     -> critic     (no tools)
critic     -> writer     (wordCount)
writer     -> critic     (no tools)
critic     -> publisher  (wordCount)

done after 6 handoffs
Q: How does agenttsm keep agent runs safe and resumable?
A: agenttsm saves a snapshot after every step, so a crashed run resumes where it stopped. ...
```

## What it shows

- An "agent" is a state handler: a system prompt plus the tools that handler calls. There is no
  separate agent abstraction to learn.
- Shared state lives in `ctx` (`notes`, `draft`, `critiques`), and every handoff is persisted.
- The critic's loop back to the writer is a declared edge (`to: ["writer", "publisher"]`), so it
  appears in `toMermaid()` and a typo is a compile error.

## Real model

```sh
LLM=anthropic ANTHROPIC_API_KEY=... pnpm --filter 06-multi-agent start
```

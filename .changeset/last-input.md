---
"@nuvraxis-org/agenttsm": minor
---

`ctx.lastInput` now holds only the input of the latest resume. `start()` drops a `lastInput` passed in its ctx, so a caller can no longer pre-seed an approval, and a resume without input (including a timed `sleep` or `until` resume) removes the previous value instead of keeping it.

---
"@nuvraxis-org/agenttsm": minor
---

Add `machine.poll()`, which resumes every `sleep` and `until` wait in the store that is due and returns the resumed snapshots. Call it from a cron job or an interval so timed waits come back after a restart or on serverless hosts. Concurrent pollers are safe: the version check lets one of them resume each run. A new `timers: false` option on `defineMachine` turns off the in-process timers for deployments that rely on `poll()` alone.

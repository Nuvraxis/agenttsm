---
"@nuvraxis-org/agenttsm-store-postgres": minor
---

First release: `PostgresStore`, a PostgreSQL `Store` for `@nuvraxis-org/agenttsm`. It takes your own `pg.Pool`, keeps runs and traces in two tables (`migrate()` or `schemaSql()` to create them), and saves each snapshot with one atomic, version-checked statement, so concurrent `resume()` and `poll()` calls get a `conflict` instead of a lost update. It passes the same conformance scenarios as `MemoryStore`.

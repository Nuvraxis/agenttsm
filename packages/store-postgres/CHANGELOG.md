# @nuvraxis-org/agenttsm-store-postgres

## 0.1.0

### Minor Changes

- ca7479b: First release: `PostgresStore`, a PostgreSQL `Store` for `@nuvraxis-org/agenttsm`. It takes your own `pg.Pool`, keeps runs and traces in two tables (`migrate()` or `schemaSql()` to create them), and saves each snapshot with one atomic, version-checked statement, so concurrent `resume()` and `poll()` calls get a `conflict` instead of a lost update. It passes the same conformance scenarios as `MemoryStore`.

### Patch Changes

- Updated dependencies [8067a3a]
- Updated dependencies [a509e42]
  - @nuvraxis-org/agenttsm@0.3.0

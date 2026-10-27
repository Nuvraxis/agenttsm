# @nuvraxis-org/agenttsm-store-postgres

A PostgreSQL `Store` for [`@nuvraxis-org/agenttsm`](https://github.com/Nuvraxis/agenttsm). Runs
survive restarts and can be resumed from any instance. It passes the same conformance scenarios as
the built-in `MemoryStore`.

```sh
pnpm add @nuvraxis-org/agenttsm @nuvraxis-org/agenttsm-store-postgres pg
```

```ts
import { defineMachine } from "@nuvraxis-org/agenttsm";
import { PostgresStore } from "@nuvraxis-org/agenttsm-store-postgres";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const store = new PostgresStore({ pool });
await store.migrate(); // once, from a deploy step: creates agenttsm_runs and agenttsm_trace

const machine = defineMachine({ initial: "draft", states, store, timers: false });
setInterval(() => machine.poll().catch(console.error), 30_000); // timed waits after restarts
```

## Options

| Option  | Default      | Meaning                                                                                                                     |
| ------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `pool`  | required     | A `pg.Pool` or `pg.Client`, or anything with the same `query(text, values)`. The store never ends it.                       |
| `table` | `"agenttsm"` | Prefix for the two tables, optionally schema-qualified: `"jobs.refunds"` uses `jobs.refunds_runs` and `jobs.refunds_trace`. |

You bring the pool, so pool size, TLS (`sslmode` in the URL), PgBouncer and sharing it with the rest
of the app stay your decisions. The package has no runtime dependencies; `pg` is an optional peer
dependency.

## Tables

`migrate()` runs `CREATE TABLE IF NOT EXISTS`, so running it again is harmless. Run it from one
place (a deploy step or a single instance), because concurrent `CREATE TABLE IF NOT EXISTS` on a
fresh database can race. To apply it with your own migration tool instead, take the statements
from `schemaSql(table?)`.

| Table           | Columns                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `<table>_runs`  | `run_id` (primary key), `version`, `status`, `state`, `snapshot` (jsonb), `created_at`, `updated_at`; index on `(status, state)` |
| `<table>_trace` | `run_id`, `version`, `position`, `entry` (jsonb); primary key `(run_id, version, position)`; rows are deleted with their run     |

## How it behaves

- **Atomic, version-checked saves.** Each `save` is a single SQL statement that updates the run only
  if it is still at the previous version (or inserts it at version 1) and appends its trace
  entries. A stale or concurrent save writes nothing and rejects with an `AgentTsmError` whose
  `code` is `"conflict"`, which is what makes concurrent `resume()` and `poll()` calls safe.
- **No explicit transactions.** Because a save is one statement, it works through a pool and
  through PgBouncer in transaction mode.
- **JSON snapshots.** Keep `ctx` to JSON values: a `Date` comes back as a string, `undefined`
  properties are dropped, and Postgres rejects strings containing `\u0000`.
- **One table set per machine.** `poll()` resumes every due run it finds with the calling machine's
  states, so give each machine its own `table`.

## Development

The tests need a Postgres. From the repository root:

```sh
docker compose up -d --wait   # Postgres 17 on 127.0.0.1:5432; POSTGRES_PORT=55433 to change the port
DATABASE_URL=postgres://agenttsm:agenttsm@127.0.0.1:5432/agenttsm pnpm --filter @nuvraxis-org/agenttsm-store-postgres test
```

Without `DATABASE_URL` the database tests are skipped. CI always sets it.

MIT © Sajankumar Vijayan

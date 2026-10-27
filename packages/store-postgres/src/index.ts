import type { ListFilter, RunEvent, Snapshot, Store, TraceEntry } from "@nuvraxis-org/agenttsm";
import { AgentTsmError } from "@nuvraxis-org/agenttsm";

/** The part of `pg.Pool` (or `pg.Client`) the store uses. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

export interface PostgresStoreOptions {
  /** A `pg.Pool`, or anything with the same `query()`. The store never ends it. */
  pool: Queryable;
  /**
   * Prefix for the two tables, optionally schema-qualified: `"agenttsm"` (the default) uses
   * `agenttsm_runs` and `agenttsm_trace`, `"jobs.refunds"` uses `jobs.refunds_runs` and
   * `jobs.refunds_trace`.
   */
  table?: string;
}

interface Tables {
  runs: string;
  trace: string;
  index: string;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,40}$/;

function tablesFor(table: string): Tables {
  const parts = table.split(".");
  if (parts.length > 2 || !parts.every((part) => IDENTIFIER.test(part))) {
    throw new AgentTsmError(
      "definition",
      `table "${table}" must be a lowercase SQL identifier, optionally schema-qualified`,
    );
  }
  const name = parts.pop() as string;
  const schema = parts.map((part) => `"${part}".`).join("");
  return {
    runs: `${schema}"${name}_runs"`,
    trace: `${schema}"${name}_trace"`,
    index: `"${name}_runs_status_state_idx"`,
  };
}

/**
 * The SQL that `migrate()` runs, one statement per entry, for applying with your own migration
 * tool instead.
 */
export function schemaSql(table = "agenttsm"): string[] {
  const t = tablesFor(table);
  return [
    `CREATE TABLE IF NOT EXISTS ${t.runs} (
  run_id text PRIMARY KEY,
  version integer NOT NULL,
  status text NOT NULL,
  state text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
)`,
    `CREATE INDEX IF NOT EXISTS ${t.index} ON ${t.runs} (status, state)`,
    `CREATE TABLE IF NOT EXISTS ${t.trace} (
  run_id text NOT NULL REFERENCES ${t.runs} (run_id) ON DELETE CASCADE,
  version integer NOT NULL,
  position integer NOT NULL,
  entry jsonb NOT NULL,
  PRIMARY KEY (run_id, version, position)
)`,
  ];
}

/**
 * A `Store` on PostgreSQL. Each `save` is one statement that checks the version, writes the
 * snapshot and appends its trace entries, so it is atomic without an explicit transaction and
 * works through a pool or PgBouncer in transaction mode.
 *
 * Snapshots are stored as JSON: keep `ctx` to JSON values (a `Date` comes back as a string, and
 * `undefined` properties are dropped).
 */
export class PostgresStore implements Store {
  readonly #pool: Queryable;
  readonly #table: string;
  readonly #t: Tables;

  constructor({ pool, table = "agenttsm" }: PostgresStoreOptions) {
    this.#pool = pool;
    this.#table = table;
    this.#t = tablesFor(table);
  }

  /** Creates the tables and index if they don't exist. Idempotent; run it from one place, such as a deploy step. */
  async migrate(): Promise<void> {
    for (const statement of schemaSql(this.#table)) await this.#pool.query(statement);
  }

  async save(snapshot: Snapshot, events: readonly RunEvent[]): Promise<void> {
    const { runs, trace } = this.#t;
    const { runId, version, status, state, createdAt, updatedAt } = snapshot;
    const entries: TraceEntry[] = [
      ...events.map((event) => ({ kind: "event" as const, event })),
      { kind: "snapshot", snapshot },
    ];
    const values = [
      runId,
      version,
      status,
      state,
      JSON.stringify(snapshot),
      updatedAt,
      JSON.stringify(entries),
    ];
    const [write, params] =
      version === 1
        ? [
            `INSERT INTO ${runs} (run_id, version, status, state, snapshot, updated_at, created_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $8)
             ON CONFLICT (run_id) DO NOTHING
             RETURNING run_id`,
            [...values, createdAt],
          ]
        : [
            `UPDATE ${runs}
             SET version = $2, status = $3, state = $4, snapshot = $5::jsonb, updated_at = $6
             WHERE run_id = $1 AND version = $2 - 1
             RETURNING run_id`,
            values,
          ];
    const { rowCount } = await this.#pool.query(
      `WITH run AS (${write})
       INSERT INTO ${trace} (run_id, version, position, entry)
       SELECT run.run_id, $2, e.position::integer, e.entry
       FROM run, jsonb_array_elements($7::jsonb) WITH ORDINALITY AS e (entry, position)`,
      params,
    );
    if (rowCount) return;
    const { rows } = await this.#pool.query(`SELECT version FROM ${runs} WHERE run_id = $1`, [
      runId,
    ]);
    const current = (rows[0] as { version: number } | undefined)?.version ?? 0;
    throw new AgentTsmError(
      "conflict",
      `run "${runId}" is at version ${current}, not ${version - 1}`,
    );
  }

  async load(runId: string): Promise<Snapshot | undefined> {
    const { rows } = await this.#pool.query(
      `SELECT snapshot FROM ${this.#t.runs} WHERE run_id = $1`,
      [runId],
    );
    return (rows[0] as { snapshot: Snapshot } | undefined)?.snapshot;
  }

  async list(filter: ListFilter = {}): Promise<Snapshot[]> {
    const { rows } = await this.#pool.query(
      `SELECT snapshot FROM ${this.#t.runs}
       WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR state = $2)
       ORDER BY created_at, run_id`,
      [filter.status ?? null, filter.state ?? null],
    );
    return (rows as { snapshot: Snapshot }[]).map((row) => row.snapshot);
  }

  async trace(runId: string): Promise<TraceEntry[]> {
    const { rows } = await this.#pool.query(
      `SELECT entry FROM ${this.#t.trace} WHERE run_id = $1 ORDER BY version, position`,
      [runId],
    );
    return (rows as { entry: TraceEntry }[]).map((row) => row.entry);
  }
}

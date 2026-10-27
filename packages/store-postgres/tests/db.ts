import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll } from "vitest";
import { PostgresStore } from "../src/index.ts";

export const url = process.env.DATABASE_URL;

/** A pool and a throwaway schema for one test file, dropped after the file's tests. */
export function useTestSchema() {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const schema = `agenttsm_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const table = `${schema}.agenttsm`;

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${schema}`);
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  return {
    pool,
    schema,
    table,
    async store(): Promise<PostgresStore> {
      const store = new PostgresStore({ pool, table });
      await store.migrate();
      return store;
    },
    async reset(): Promise<void> {
      await pool.query(`TRUNCATE ${schema}.agenttsm_runs CASCADE`);
    },
  };
}

import { describe, it } from "vitest";
import { describeConformance } from "../../core/tests/conformance.ts";
import { url, useTestSchema } from "./db.ts";

if (url) {
  const db = useTestSchema();
  describeConformance("PostgresStore", async () => {
    const store = await db.store();
    await db.reset();
    return store;
  });
} else {
  describe.skip("conformance (PostgresStore)", () => {
    it("needs DATABASE_URL", () => undefined);
  });
}

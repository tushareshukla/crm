/**
 * Preload for the API suite (`bun test --preload ./test/setup.ts`). Creates
 * the default test organization every database-backed test runs in, and
 * closes the pool when the run is over.
 */
import { afterAll } from "bun:test";
import { ensureTestOrganization, TEST_ORG } from "./tenant";

export { TEST_ORG };

await ensureTestOrganization();

afterAll(async () => {
	const { db } = await import("@crm/db");
	await db.$disconnect();
});

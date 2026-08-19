import type { Tx } from "@crm/db";

export async function lockIdempotencyKey(tx: Tx, key: string): Promise<void> {
	await tx.$queryRaw<Array<{ locked: boolean }>>`
		SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS locked
	`;
}

import { currentTenantId, type Db } from "@crm/db";
import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

export const MAX_BULK_IDS = 100;

export const bulkIdsInput = z.object({
	ids: z
		.array(z.string())
		.min(1, "Nothing was selected.")
		.max(MAX_BULK_IDS, "Too many records at once — select a page at a time."),
});

export type BulkResult = {
	requested: number;
	succeeded: number;
	failed: number;
	message: string | null;
};

export async function requireOwner(
	db: Db,
	ownerId: string | null | undefined,
): Promise<void> {
	if (!ownerId) return;

	// User and Member are global models: an id names a valid owner only when
	// that user is a member of the current organization.
	const member = await db.member.findFirst({
		where: { organizationId: currentTenantId(), userId: ownerId },
		select: { id: true },
	});

	if (!member) {
		throw new BadRequestException("That owner does not work here any more.");
	}
}

export async function runBulk(
	ids: string[],
	act: (id: string) => Promise<unknown>,
): Promise<BulkResult> {
	const unique = [...new Set(ids)];
	let succeeded = 0;
	let message: string | null = null;

	for (const id of unique) {
		try {
			await act(id);
			succeeded += 1;
		} catch (error) {
			message ??=
				error instanceof Error ? error.message : "Something went wrong.";
		}
	}

	return {
		requested: unique.length,
		succeeded,
		failed: unique.length - succeeded,
		message,
	};
}

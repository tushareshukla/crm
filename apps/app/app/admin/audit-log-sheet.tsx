"use client";

import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@crm/ui/components/sheet";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AuditEventList } from "@/components/audit-event-list";
import { useTRPC } from "@/lib/trpc/client";
import type { AdminOrganization } from "./organizations-table";

const PAGE = 50;

export function AuditLogSheet({
	organization,
	onClose,
}: {
	organization: AdminOrganization | null;
	onClose: () => void;
}) {
	return (
		<Sheet
			open={organization !== null}
			onOpenChange={(open) => !open && onClose()}
		>
			<SheetContent side="right" className="sm:max-w-lg">
				{organization ? (
					<AuditLog key={organization.id} organization={organization} />
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function AuditLog({ organization }: { organization: AdminOrganization }) {
	const trpc = useTRPC();

	const log = useInfiniteQuery(
		trpc.admin.auditLog.infiniteQueryOptions(
			{ organizationId: organization.id, limit: PAGE },
			{ getNextPageParam: (page) => page.nextCursor ?? undefined },
		),
	);

	const events = log.data?.pages.flatMap((page) => page.rows) ?? [];

	return (
		<>
			<SheetHeader>
				<SheetTitle>Audit log · {organization.name}</SheetTitle>
				<SheetDescription>
					Everything the platform and the organization's admins have done to it,
					newest first.
				</SheetDescription>
			</SheetHeader>

			<div className="flex-1 overflow-y-auto px-4 pb-4">
				{log.isError ? (
					<p className="text-destructive text-sm">{log.error.message}</p>
				) : (
					<AuditEventList
						events={events}
						loading={log.isPending || log.isFetchingNextPage}
						hasMore={log.hasNextPage}
						onMore={() => void log.fetchNextPage()}
					/>
				)}
			</div>
		</>
	);
}

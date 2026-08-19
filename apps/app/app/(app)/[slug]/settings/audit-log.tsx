"use client";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AuditEventList } from "@/components/audit-event-list";
import { useTRPC } from "@/lib/trpc/client";

const PAGE = 25;

/** What has been done to this organization — owners and admins only; the API refuses everyone else. */
export function AuditLog() {
	const trpc = useTRPC();

	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const allowed = workspace.data?.canChangeRoles ?? false;

	const log = useInfiniteQuery({
		...trpc.audit.list.infiniteQueryOptions(
			{ limit: PAGE },
			{ getNextPageParam: (page) => page.nextCursor ?? undefined },
		),
		enabled: allowed,
	});

	if (!allowed) return null;

	const events = log.data?.pages.flatMap((page) => page.rows) ?? [];

	return (
		<Card>
			<CardHeader>
				<CardTitle>Audit log</CardTitle>
				<CardDescription>
					Invitations, role changes, renames and every visit by a platform admin
					— newest first.
				</CardDescription>
			</CardHeader>

			<CardContent>
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
			</CardContent>
		</Card>
	);
}

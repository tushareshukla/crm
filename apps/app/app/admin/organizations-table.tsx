"use client";

import OverflowMenuHorizontal from "@carbon/icons-react/es/OverflowMenuHorizontal";
import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@crm/ui/components/empty";
import { Icon } from "@crm/ui/components/icon";
import {
	SimpleTable,
	type SimpleTableColumn,
	SimpleTableRow,
} from "@crm/ui/components/simple-table";
import { TableCell } from "@crm/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { LocalRelativeTime } from "@/components/local-date-time";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { workspaceUrl } from "@/lib/workspace-url";
import { AuditLogSheet } from "./audit-log-sheet";
import { DeleteOrganizationDialog } from "./delete-organization-dialog";
import { EditLimitsDialog } from "./edit-limits-dialog";

export type AdminOrganization =
	RouterOutputs["admin"]["listOrganizations"][number];

const COLUMNS: SimpleTableColumn[] = [
	{ id: "name", header: "Name", width: "w-[26%]" },
	{ id: "slug", header: "Address", width: "w-[18%]" },
	{ id: "status", header: "Status", width: "w-[12%]" },
	{ id: "members", header: "Members", width: "w-[10%]", align: "right" },
	{ id: "invites", header: "Pending", width: "w-[10%]", align: "right" },
	{ id: "created", header: "Created", width: "w-[16%]", align: "right" },
	{ id: "actions", srLabel: "Actions", width: "w-[8%]", align: "right" },
];

type Action =
	| { kind: "limits"; organization: AdminOrganization }
	| { kind: "audit"; organization: AdminOrganization }
	| { kind: "delete"; organization: AdminOrganization };

export function OrganizationsTable() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const organizations = useQuery(trpc.admin.listOrganizations.queryOptions());
	const [action, setAction] = useState<Action | null>(null);

	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.admin.listOrganizations.queryKey(),
		});

	const suspend = useMutation(
		trpc.admin.suspend.mutationOptions({
			onSuccess: async () => {
				await refresh();
				toast.success("Organization suspended.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const unsuspend = useMutation(
		trpc.admin.unsuspend.mutationOptions({
			onSuccess: async () => {
				await refresh();
				toast.success("Organization reinstated.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const busy = suspend.isPending || unsuspend.isPending;
	const rows = organizations.data ?? [];

	if (organizations.isError) {
		return (
			<p className="text-destructive text-sm">{organizations.error.message}</p>
		);
	}

	if (!organizations.isPending && rows.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>No organizations yet</EmptyTitle>
					<EmptyDescription>
						Create the first one and invite its owner with the link you get
						back.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<>
			<SimpleTable columns={COLUMNS}>
				{rows.map((organization) => {
					const suspended = organization.status === "SUSPENDED";

					return (
						<SimpleTableRow key={organization.id}>
							<TableCell className="truncate font-medium">
								{suspended ? (
									organization.name
								) : (
									<Link
										href={workspaceUrl(organization.slug)}
										className="hover:underline"
									>
										{organization.name}
									</Link>
								)}
							</TableCell>
							<TableCell className="truncate font-mono text-muted-foreground text-xs">
								/{organization.slug}
							</TableCell>
							<TableCell>
								{suspended ? (
									<Badge variant="destructive">Suspended</Badge>
								) : (
									<Badge variant="outline">Active</Badge>
								)}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{organization.memberCount}
								{organization.limits.maxMembers !== null ? (
									<span className="text-muted-foreground">
										{" "}
										/ {organization.limits.maxMembers}
									</span>
								) : null}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{organization.pendingInvites}
							</TableCell>
							<TableCell className="text-right text-muted-foreground">
								<LocalRelativeTime date={organization.createdAt} />
							</TableCell>
							<TableCell className="text-right">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon" disabled={busy}>
											<Icon icon={OverflowMenuHorizontal} />
											<span className="sr-only">
												Actions for {organization.name}
											</span>
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem asChild disabled={suspended}>
											<Link href={workspaceUrl(organization.slug)}>Enter</Link>
										</DropdownMenuItem>
										<DropdownMenuItem
											onSelect={() =>
												setAction({ kind: "limits", organization })
											}
										>
											Edit limits
										</DropdownMenuItem>
										<DropdownMenuItem
											onSelect={() =>
												setAction({ kind: "audit", organization })
											}
										>
											Audit log
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										{suspended ? (
											<DropdownMenuItem
												onSelect={() =>
													unsuspend.mutate({ id: organization.id })
												}
											>
												Reinstate
											</DropdownMenuItem>
										) : (
											<DropdownMenuItem
												onSelect={() => suspend.mutate({ id: organization.id })}
											>
												Suspend
											</DropdownMenuItem>
										)}
										<DropdownMenuItem
											variant="destructive"
											onSelect={() =>
												setAction({ kind: "delete", organization })
											}
										>
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</TableCell>
						</SimpleTableRow>
					);
				})}
			</SimpleTable>

			<EditLimitsDialog
				organization={action?.kind === "limits" ? action.organization : null}
				onClose={() => setAction(null)}
			/>
			<AuditLogSheet
				organization={action?.kind === "audit" ? action.organization : null}
				onClose={() => setAction(null)}
			/>
			<DeleteOrganizationDialog
				organization={action?.kind === "delete" ? action.organization : null}
				onClose={() => setAction(null)}
			/>
		</>
	);
}

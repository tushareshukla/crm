"use client";

import Copy from "@carbon/icons-react/es/Copy";
import TrashCan from "@carbon/icons-react/es/TrashCan";
import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
import { Icon } from "@crm/ui/components/icon";
import {
	SimpleTable,
	type SimpleTableColumn,
	SimpleTableRow,
} from "@crm/ui/components/simple-table";
import { TableCell } from "@crm/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { copyToClipboard } from "@/components/copy-link";
import { LocalRelativeTime } from "@/components/local-date-time";
import { useTRPC } from "@/lib/trpc/client";

const ROLE_LABEL = {
	member: "Member",
	admin: "Admin",
	owner: "Owner",
} as const;

const COLUMNS: SimpleTableColumn[] = [
	{ id: "email", header: "Email", width: "w-[40%]" },
	{ id: "role", header: "Role", width: "w-[15%]" },
	{ id: "invited", header: "Invited", width: "w-[20%]" },
	{ id: "expires", header: "Expires", width: "w-[15%]" },
	{ id: "actions", srLabel: "Actions", width: "w-[10%]", align: "right" },
];

/** Invitations that have not been used yet — copy the link again, or take it back. */
export function PendingInvites() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const allowed = workspace.data?.canChangeRoles ?? false;

	const invites = useQuery({
		...trpc.invites.list.queryOptions(),
		enabled: allowed,
	});

	const revoke = useMutation(
		trpc.invites.revoke.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.invites.list.queryKey(),
				});
				toast.success("Invitation revoked.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!allowed) return null;

	const rows = invites.data ?? [];

	if (invites.isPending || rows.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Pending invitations</CardTitle>
				<CardDescription>
					Links that have been made but not used yet. Each works once, for the
					address it names.
				</CardDescription>
			</CardHeader>

			<CardContent>
				<SimpleTable columns={COLUMNS}>
					{rows.map((invite) => (
						<SimpleTableRow key={invite.id}>
							<TableCell className="truncate font-medium">
								{invite.email}
							</TableCell>
							<TableCell className="text-muted-foreground">
								{ROLE_LABEL[invite.role]}
							</TableCell>
							<TableCell className="text-muted-foreground">
								<LocalRelativeTime date={invite.createdAt} />
								{invite.inviter ? (
									<span className="text-xs"> by {invite.inviter.name}</span>
								) : null}
							</TableCell>
							<TableCell className="text-muted-foreground">
								<LocalRelativeTime date={invite.expiresAt} />
							</TableCell>
							<TableCell className="text-right">
								<div className="flex justify-end gap-1">
									<Button
										variant="ghost"
										size="icon"
										type="button"
										onClick={() =>
											copyToClipboard(invite.url, "Invitation link")
										}
									>
										<Icon icon={Copy} />
										<span className="sr-only">
											Copy the link for {invite.email}
										</span>
									</Button>
									<Button
										variant="ghost"
										size="icon"
										type="button"
										disabled={revoke.isPending}
										onClick={() => revoke.mutate({ id: invite.id })}
									>
										<Icon icon={TrashCan} />
										<span className="sr-only">
											Revoke the invitation for {invite.email}
										</span>
									</Button>
								</div>
							</TableCell>
						</SimpleTableRow>
					))}
				</SimpleTable>
			</CardContent>
		</Card>
	);
}

"use client";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@crm/ui/components/alert-dialog";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";
import type { AdminOrganization } from "./organizations-table";

/** Deleting a tenant takes all its data with it; the admin types the address to confirm. */
export function DeleteOrganizationDialog({
	organization,
	onClose,
}: {
	organization: AdminOrganization | null;
	onClose: () => void;
}) {
	return (
		<AlertDialog
			open={organization !== null}
			onOpenChange={(open) => !open && onClose()}
		>
			<AlertDialogContent>
				{organization ? (
					<Confirm
						key={organization.id}
						organization={organization}
						onClose={onClose}
					/>
				) : null}
			</AlertDialogContent>
		</AlertDialog>
	);
}

function Confirm({
	organization,
	onClose,
}: {
	organization: AdminOrganization;
	onClose: () => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const confirmId = useId();
	const [typed, setTyped] = useState("");

	const remove = useMutation(
		trpc.admin.deleteOrganization.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.admin.listOrganizations.queryKey(),
				});
				toast.success(`${organization.name} deleted.`);
				onClose();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const confirmed = typed.trim() === organization.slug;

	return (
		<>
			<AlertDialogHeader>
				<AlertDialogTitle>Delete {organization.name}?</AlertDialogTitle>
				<AlertDialogDescription>
					Every company, contact, deal, conversation and setting in it goes too,
					along with its {organization.memberCount} membership
					{organization.memberCount === 1 ? "" : "s"}. This cannot be undone.
					Type <span className="font-mono">{organization.slug}</span> to
					confirm.
				</AlertDialogDescription>
			</AlertDialogHeader>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor={confirmId}>Address</Label>
				<Input
					id={confirmId}
					value={typed}
					onChange={(event) => setTyped(event.target.value)}
					placeholder={organization.slug}
					autoComplete="off"
					autoCapitalize="off"
					autoCorrect="off"
					spellCheck={false}
				/>
			</div>

			<AlertDialogFooter>
				<AlertDialogCancel disabled={remove.isPending}>
					Cancel
				</AlertDialogCancel>
				<AlertDialogAction
					disabled={!confirmed || remove.isPending}
					onClick={(event) => {
						event.preventDefault();
						remove.mutate({ id: organization.id });
					}}
				>
					Delete organization
				</AlertDialogAction>
			</AlertDialogFooter>
		</>
	);
}

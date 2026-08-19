"use client";

import { Button } from "@crm/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@crm/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { parseLimit } from "@/lib/org-limits";
import { useTRPC } from "@/lib/trpc/client";
import type { AdminOrganization } from "./organizations-table";

const FORM = "edit-limits";

type Limits = AdminOrganization["limits"];

type LimitKey = keyof Limits;

const LIMITS: {
	key: LimitKey;
	label: string;
	hint: string;
	min: number;
}[] = [
	{
		key: "maxMembers",
		label: "Members",
		hint: "How many people may belong to it.",
		min: 1,
	},
	{
		key: "maxContacts",
		label: "Contacts",
		hint: "How many contacts it may hold.",
		min: 1,
	},
	{
		key: "agentTasksPerDay",
		label: "Agent tasks per day",
		hint: "Research the platform pays for on its behalf each day. 0 turns the agent off.",
		min: 0,
	},
];

function toDraft(limits: Limits): Record<LimitKey, string> {
	return {
		maxMembers: limits.maxMembers?.toString() ?? "",
		maxContacts: limits.maxContacts?.toString() ?? "",
		agentTasksPerDay: limits.agentTasksPerDay?.toString() ?? "",
	};
}

export function EditLimitsDialog({
	organization,
	onClose,
}: {
	organization: AdminOrganization | null;
	onClose: () => void;
}) {
	return (
		<Dialog
			open={organization !== null}
			onOpenChange={(open) => !open && onClose()}
		>
			<DialogContent className="sm:max-w-md">
				{organization ? (
					<LimitsForm
						key={organization.id}
						organization={organization}
						onClose={onClose}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function LimitsForm({
	organization,
	onClose,
}: {
	organization: AdminOrganization;
	onClose: () => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const baseId = useId();

	const [draft, setDraft] = useState(() => toDraft(organization.limits));

	const save = useMutation(
		trpc.admin.updateOrganization.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.admin.listOrganizations.queryKey(),
				});
				toast.success("Limits saved.");
				onClose();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const parsed = LIMITS.map((limit) => ({
		...limit,
		result: parseLimit(draft[limit.key], limit.min),
	}));
	const valid = parsed.every((limit) => limit.result.ok);

	return (
		<>
			<DialogHeader>
				<DialogTitle>Limits for {organization.name}</DialogTitle>
				<DialogDescription>
					Leave a field blank to use the platform default.
				</DialogDescription>
			</DialogHeader>

			<form
				id={FORM}
				onSubmit={(event) => {
					event.preventDefault();
					if (!valid) return;

					const limits: Partial<Limits> = {};
					for (const limit of parsed) {
						if (limit.result.ok) limits[limit.key] = limit.result.value;
					}
					save.mutate({ id: organization.id, limits });
				}}
			>
				<FieldGroup>
					{parsed.map((limit) => (
						<Field key={limit.key}>
							<FieldLabel htmlFor={`${baseId}-${limit.key}`}>
								{limit.label}
							</FieldLabel>
							<Input
								id={`${baseId}-${limit.key}`}
								inputMode="numeric"
								value={draft[limit.key]}
								onChange={(event) =>
									setDraft({ ...draft, [limit.key]: event.target.value })
								}
								placeholder="Default"
								aria-invalid={!limit.result.ok}
							/>
							<FieldDescription>{limit.hint}</FieldDescription>
						</Field>
					))}
				</FieldGroup>
			</form>

			<DialogFooter>
				<Button type="button" variant="outline" onClick={onClose}>
					Cancel
				</Button>
				<Button type="submit" form={FORM} disabled={save.isPending || !valid}>
					{save.isPending ? <Spinner data-icon="inline-start" /> : null}
					Save
				</Button>
			</DialogFooter>
		</>
	);
}

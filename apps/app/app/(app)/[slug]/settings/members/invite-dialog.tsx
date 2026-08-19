"use client";

import UserFollow from "@carbon/icons-react/es/UserFollow";
import { Button } from "@crm/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@crm/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Icon } from "@crm/ui/components/icon";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ComponentProps, Suspense, useId, useState } from "react";
import { toast } from "sonner";
import { CopyLink } from "@/components/copy-link";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

const FORM = "invite-member";

const ROLE_LABEL = {
	member: "Member",
	admin: "Admin",
	owner: "Owner",
} as const;

type Role = keyof typeof ROLE_LABEL;

type Invite = RouterOutputs["invites"]["create"];

function InviteButton(props: ComponentProps<typeof Button>) {
	return (
		<Button {...props}>
			<Icon icon={UserFollow} data-icon="inline-start" />
			Invite
		</Button>
	);
}

/** Owners and admins invite by copy-link: the dialog makes the link and hands it over. */
export function InviteDialog() {
	return (
		<Suspense fallback={<InviteButton disabled />}>
			<InviteForm />
		</Suspense>
	);
}

function InviteForm() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const canInvite = workspace.data?.canChangeRoles ?? false;
	// Only an owner may hand out ownership; support mode may do anything.
	const canInviteOwner =
		workspace.data?.supportMode || workspace.data?.viewerRole === "owner";

	const emailId = useId();
	const roleId = useId();
	const linkId = useId();

	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<Role>("member");
	const [created, setCreated] = useState<Invite | null>(null);

	const invite = useMutation(
		trpc.invites.create.mutationOptions({
			onSuccess: async (result) => {
				setCreated(result);
				await queryClient.invalidateQueries({
					queryKey: trpc.invites.list.queryKey(),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const reset = () => {
		setEmail("");
		setRole("member");
		setCreated(null);
		invite.reset();
	};

	if (!canInvite) return null;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) reset();
			}}
		>
			<DialogTrigger asChild>
				<InviteButton />
			</DialogTrigger>

			<DialogContent className="sm:max-w-md">
				{created ? (
					<>
						<DialogHeader>
							<DialogTitle>Invitation ready</DialogTitle>
							<DialogDescription>
								Send this link to {created.email}. It works once, only for that
								address, and expires after a while — nothing is emailed
								automatically.
							</DialogDescription>
						</DialogHeader>

						<Field>
							<FieldLabel htmlFor={linkId}>Invitation link</FieldLabel>
							<CopyLink
								id={linkId}
								value={created.url}
								label="Invitation link"
							/>
							<FieldDescription>
								Joins as {ROLE_LABEL[created.role]}. You can revoke it from the
								pending list until it is used.
							</FieldDescription>
						</Field>

						<DialogFooter>
							<Button type="button" variant="outline" onClick={reset}>
								Invite someone else
							</Button>
							<Button type="button" onClick={() => setOpen(false)}>
								Done
							</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>Invite to this organization</DialogTitle>
							<DialogDescription>
								You'll get a link to send them. They sign in (or sign up) with
								this address and the link adds them.
							</DialogDescription>
						</DialogHeader>

						<form
							id={FORM}
							onSubmit={(event) => {
								event.preventDefault();
								invite.mutate({ email: email.trim(), role });
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor={emailId}>Email</FieldLabel>
									<Input
										id={emailId}
										type="email"
										value={email}
										onChange={(event) => setEmail(event.target.value)}
										placeholder="jane@acme.com"
										autoComplete="off"
										autoFocus
										required
									/>
								</Field>

								<Field>
									<FieldLabel htmlFor={roleId}>Role</FieldLabel>
									<Select
										value={role}
										onValueChange={(value) => setRole(value as Role)}
									>
										<SelectTrigger id={roleId} className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{(Object.keys(ROLE_LABEL) as Role[]).map((option) => (
												<SelectItem
													key={option}
													value={option}
													disabled={option === "owner" && !canInviteOwner}
												>
													{ROLE_LABEL[option]}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FieldDescription>
										Admins manage settings and people; owners can also hand over
										ownership.
									</FieldDescription>
								</Field>
							</FieldGroup>
						</form>

						<DialogFooter>
							<Button
								type="submit"
								form={FORM}
								disabled={invite.isPending || email.trim() === ""}
							>
								{invite.isPending ? <Spinner data-icon="inline-start" /> : null}
								Create link
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

"use client";

import Add from "@carbon/icons-react/es/Add";
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
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@crm/ui/components/input-group";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { CopyLink } from "@/components/copy-link";
import { slugDraft, slugify } from "@/lib/slugify";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { workspaceUrl } from "@/lib/workspace-url";

const FORM = "create-organization";

const EMPTY = { name: "", slug: "", ownerEmail: "" };

type Created = RouterOutputs["admin"]["createOrganization"];

/**
 * A new tenant: a name, the address it lives at (derived from the name until
 * edited) and who owns it. The owner gets an invitation link back — unless
 * they are already a user, in which case they are simply added.
 */
export function CreateOrganizationDialog() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const nameId = useId();
	const slugId = useId();
	const ownerId = useId();
	const linkId = useId();

	const [open, setOpen] = useState(false);
	const [values, setValues] = useState(EMPTY);
	const [created, setCreated] = useState<Created | null>(null);
	const slugEdited = useRef(false);

	const create = useMutation(
		trpc.admin.createOrganization.mutationOptions({
			onSuccess: async (result) => {
				setCreated(result);
				await queryClient.invalidateQueries({
					queryKey: trpc.admin.listOrganizations.queryKey(),
				});
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const reset = () => {
		setValues(EMPTY);
		setCreated(null);
		slugEdited.current = false;
		create.reset();
	};

	const edit = (patch: Partial<typeof values>) =>
		setValues({ ...values, ...patch });

	const slug = slugify(values.slug);
	const complete =
		values.name.trim() !== "" && slug !== "" && values.ownerEmail.trim() !== "";

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) reset();
			}}
		>
			<DialogTrigger asChild>
				<Button>
					<Icon icon={Add} data-icon="inline-start" />
					Create organization
				</Button>
			</DialogTrigger>

			<DialogContent className="sm:max-w-md">
				{created ? (
					<>
						<DialogHeader>
							<DialogTitle>{created.organization.name} is ready</DialogTitle>
							<DialogDescription>
								{created.inviteUrl
									? `Send this link to ${values.ownerEmail.trim()}. Signing in (or up) with that address and opening it makes them the owner.`
									: `${values.ownerEmail.trim()} already had an account, so they were added as the owner directly — there is no link to send.`}
							</DialogDescription>
						</DialogHeader>

						{created.inviteUrl ? (
							<Field>
								<FieldLabel htmlFor={linkId}>Owner invitation link</FieldLabel>
								<CopyLink
									id={linkId}
									value={created.inviteUrl}
									label="Invitation link"
								/>
								<FieldDescription>
									It works once, for that address only, and expires. Until it is
									used it shows under the organization's pending invitations.
								</FieldDescription>
							</Field>
						) : null}

						<DialogFooter>
							<Button asChild variant="outline">
								<Link href={workspaceUrl(created.organization.slug)}>
									Enter
								</Link>
							</Button>
							<Button type="button" onClick={() => setOpen(false)}>
								Done
							</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>Create an organization</DialogTitle>
							<DialogDescription>
								A new tenant with its own data, people and settings.
							</DialogDescription>
						</DialogHeader>

						<form
							id={FORM}
							onSubmit={(event) => {
								event.preventDefault();
								create.mutate({
									name: values.name.trim(),
									slug,
									ownerEmail: values.ownerEmail.trim(),
								});
							}}
						>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor={nameId}>Name</FieldLabel>
									<Input
										id={nameId}
										value={values.name}
										onChange={(event) => {
											const name = event.target.value;
											edit(
												slugEdited.current
													? { name }
													: { name, slug: slugify(name) },
											);
										}}
										placeholder="Acme Inc."
										autoComplete="organization"
										autoFocus
										required
									/>
								</Field>

								<Field>
									<FieldLabel htmlFor={slugId}>Address</FieldLabel>
									<InputGroup>
										<InputGroupAddon>
											<InputGroupText>/</InputGroupText>
										</InputGroupAddon>
										<InputGroupInput
											id={slugId}
											value={values.slug}
											onChange={(event) => {
												slugEdited.current = true;
												edit({ slug: slugDraft(event.target.value) });
											}}
											onBlur={() => edit({ slug: slugify(values.slug) })}
											placeholder="acme"
											autoComplete="off"
											autoCapitalize="off"
											autoCorrect="off"
											spellCheck={false}
											required
										/>
									</InputGroup>
									<FieldDescription>
										Where the team opens the CRM. The owner can change it later.
									</FieldDescription>
								</Field>

								<Field>
									<FieldLabel htmlFor={ownerId}>Owner's email</FieldLabel>
									<Input
										id={ownerId}
										type="email"
										value={values.ownerEmail}
										onChange={(event) =>
											edit({ ownerEmail: event.target.value })
										}
										placeholder="jane@acme.com"
										autoComplete="off"
										required
									/>
									<FieldDescription>
										They get an invitation link to copy and send; nothing is
										emailed automatically.
									</FieldDescription>
								</Field>
							</FieldGroup>
						</form>

						<DialogFooter>
							<Button
								type="submit"
								form={FORM}
								disabled={create.isPending || !complete}
							>
								{create.isPending ? <Spinner data-icon="inline-start" /> : null}
								Create
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

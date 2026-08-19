"use client";

import { Button } from "@crm/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@crm/ui/components/input-group";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { researchPath } from "@/lib/setup-paths";
import { slugDraft, slugify } from "@/lib/slugify";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceSlug } from "@/lib/use-workspace-url";

export function OnboardingForm({ placeholder }: { placeholder: string }) {
	const trpc = useTRPC();
	const router = useRouter();
	const currentSlug = useWorkspaceSlug();

	// The platform admin already named the organization; start from that.
	const workspace = useQuery(trpc.workspace.get.queryOptions());

	const nameId = useId();
	const slugId = useId();
	const websiteId = useId();
	const [draft, setDraft] = useState<{ name: string; slug: string } | null>(
		null,
	);
	const slugEdited = useRef(false);

	const values = draft ?? {
		name: workspace.data?.name ?? "",
		slug: workspace.data?.slug ?? currentSlug,
	};

	const save = useMutation(
		trpc.workspace.update.mutationOptions({
			onSuccess: (saved) => {
				const next = researchPath(saved.slug);

				// A new address means a new tenant URL: start it from a clean cache.
				if (saved.slug !== currentSlug) {
					window.location.assign(next);
					return;
				}

				router.refresh();
				router.replace(next);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();

				const form = new FormData(event.currentTarget);

				save.mutate({
					name: values.name.trim(),
					slug: slugify(values.slug) || undefined,
					website: String(form.get("website") ?? "").trim(),
				});
			}}
			className="flex flex-col gap-6"
		>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor={nameId}>Company name</FieldLabel>
					<Input
						id={nameId}
						name="name"
						value={values.name}
						onChange={(event) => {
							const name = event.target.value;
							setDraft({
								name,
								slug: slugEdited.current ? values.slug : slugify(name),
							});
						}}
						placeholder={placeholder}
						autoComplete="organization"
						autoFocus
						required
					/>
				</Field>

				<Field>
					<FieldLabel htmlFor={slugId}>Workspace URL</FieldLabel>
					<InputGroup>
						<InputGroupAddon>
							<InputGroupText>/</InputGroupText>
						</InputGroupAddon>
						<InputGroupInput
							id={slugId}
							name="slug"
							value={values.slug}
							onChange={(event) => {
								slugEdited.current = true;
								setDraft({ ...values, slug: slugDraft(event.target.value) });
							}}
							onBlur={() => setDraft({ ...values, slug: slugify(values.slug) })}
							placeholder={slugify(placeholder)}
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							required
						/>
					</InputGroup>
					<FieldDescription>
						Your team will use this address to open the CRM.
					</FieldDescription>
				</Field>

				<Field>
					<FieldLabel htmlFor={websiteId}>Website</FieldLabel>
					<InputGroup>
						<InputGroupAddon>
							<InputGroupText>https://</InputGroupText>
						</InputGroupAddon>
						<InputGroupInput
							id={websiteId}
							name="website"
							defaultValue={workspace.data?.website ?? ""}
							placeholder="acme.com"
							autoComplete="off"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							inputMode="url"
							required
						/>
					</InputGroup>
					<FieldDescription>
						Read once, so every answer afterwards knows what you sell.
					</FieldDescription>
				</Field>
			</FieldGroup>

			<Button type="submit" disabled={save.isPending}>
				{save.isPending ? <Spinner data-icon="inline-start" /> : null}
				Continue
			</Button>
		</form>
	);
}

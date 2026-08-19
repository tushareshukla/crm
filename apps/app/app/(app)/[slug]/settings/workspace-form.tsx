"use client";

import { Button } from "@crm/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@crm/ui/components/card";
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
import { useId, useState } from "react";
import { toast } from "sonner";
import { slugDraft, slugify } from "@/lib/slugify";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceSlug } from "@/lib/use-workspace-url";
import { workspaceUrl } from "@/lib/workspace-url";

type Draft = { name: string; slug: string; website: string };

export function WorkspaceForm() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const router = useRouter();
	const slug = useWorkspaceSlug();

	const nameId = useId();
	const slugId = useId();
	const websiteId = useId();

	const workspace = useQuery(trpc.workspace.get.queryOptions());

	const [draft, setDraft] = useState<Draft | null>(null);

	const save = useMutation(
		trpc.workspace.update.mutationOptions({
			onSuccess: async (saved) => {
				if (saved.slug !== slug) {
					// The address is the tenant: every call from the new URL names
					// the organization by its new slug, so a full navigation starts
					// it from a clean cache.
					window.location.assign(workspaceUrl(saved.slug, "/settings"));
					return;
				}

				await cache.workspace();
				setDraft(null);
				toast.success("Organization saved.");
				// The header shows the name from the server; let it catch up.
				router.refresh();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (!workspace.data) return null;

	const { name, website, canRename } = workspace.data;
	const current: Draft = {
		name,
		slug: workspace.data.slug,
		website: website ?? "",
	};

	const values = draft ?? current;
	const dirty =
		values.name !== current.name ||
		values.slug !== current.slug ||
		values.website !== current.website;

	const edit = (patch: Partial<Draft>) => setDraft({ ...values, ...patch });

	return (
		<Card>
			<CardHeader>
				<CardTitle>Organization</CardTitle>
				<CardDescription>
					The name, address and website of the company using this CRM.
				</CardDescription>

				<CardAction>
					<Button
						type="submit"
						form="workspace"
						disabled={
							!canRename ||
							save.isPending ||
							!dirty ||
							values.name.trim() === "" ||
							slugify(values.slug) === "" ||
							values.website.trim() === ""
						}
					>
						{save.isPending ? <Spinner data-icon="inline-start" /> : null}
						Save
					</Button>
				</CardAction>
			</CardHeader>

			<CardContent>
				<form
					id="workspace"
					onSubmit={(event) => {
						event.preventDefault();
						save.mutate({
							name: values.name,
							slug: slugify(values.slug),
							website: values.website.trim(),
						});
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor={nameId}>Name</FieldLabel>
							<Input
								id={nameId}
								value={values.name}
								onChange={(event) => edit({ name: event.target.value })}
								placeholder="Acme Inc."
								autoComplete="organization"
								disabled={!canRename || save.isPending}
								required
							/>
							<FieldDescription>
								Shown wherever the CRM refers to your own company.
							</FieldDescription>
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
									onChange={(event) =>
										edit({ slug: slugDraft(event.target.value) })
									}
									onBlur={() => edit({ slug: slugify(values.slug) })}
									placeholder="acme"
									autoComplete="off"
									autoCapitalize="off"
									autoCorrect="off"
									spellCheck={false}
									disabled={!canRename || save.isPending}
									required
								/>
							</InputGroup>
							<FieldDescription>
								Your team opens the CRM at this address. Changing it moves
								everyone to the new one — old links stop working.
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
									value={values.website}
									onChange={(event) => edit({ website: event.target.value })}
									placeholder="acme.com"
									autoComplete="off"
									autoCapitalize="off"
									autoCorrect="off"
									spellCheck={false}
									inputMode="url"
									disabled={!canRename || save.isPending}
								/>
							</InputGroup>
							<FieldDescription>Your own company's website.</FieldDescription>
						</Field>
					</FieldGroup>
				</form>

				{canRename ? null : (
					<p className="text-muted-foreground text-xs">
						Only an owner or an admin can change this.
					</p>
				)}
			</CardContent>
		</Card>
	);
}

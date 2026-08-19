import { DEFAULT_WORKSPACE_NAME } from "@crm/auth";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { loadOrganization } from "@/lib/organization";
import { requireMailboxAccess } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
	title: "Set up",
};

export const instant = false;

/** First visit to a fresh organization: name it and say what it sells. */
export default async function OnboardingPage({
	params,
}: PageProps<"/[slug]/onboarding">) {
	const [, { slug }] = await Promise.all([requireMailboxAccess(), params]);

	const organization = await loadOrganization(slug);
	if (!organization) notFound();

	await getServerQueryClient().prefetchQuery(
		getServerTrpc().workspace.get.queryOptions(),
	);

	return (
		<AuthShell>
			<AuthHeading
				title="Tell us about your company"
				description="Two things, once. The name is what the CRM calls you; the website is how the agent learns what you sell."
			/>

			<HydrateClient>
				<OnboardingForm placeholder={DEFAULT_WORKSPACE_NAME} />
			</HydrateClient>
		</AuthShell>
	);
}

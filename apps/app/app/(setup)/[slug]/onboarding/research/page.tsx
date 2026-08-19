import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { loadOrganization } from "@/lib/organization";
import { requireMailboxAccess } from "@/lib/session";
import { ResearchForm } from "./research-form";

export const metadata: Metadata = {
	title: "Research key",
};

export const instant = false;

export default async function ResearchKeyPage({
	params,
}: PageProps<"/[slug]/onboarding/research">) {
	const [, { slug }] = await Promise.all([requireMailboxAccess(), params]);

	if (!(await loadOrganization(slug))) notFound();

	return (
		<AuthShell>
			<AuthHeading
				title="Level up your CRM data"
				description="Power your research agent with Context to research every company added to your CRM."
			/>

			<ResearchForm />
		</AuthShell>
	);
}

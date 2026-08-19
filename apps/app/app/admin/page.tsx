import type { Metadata } from "next";
import { Suspense } from "react";
import {
	PageShell,
	PageShellActions,
	PageShellContent,
	PageShellDescription,
	PageShellHeader,
	PageShellHeading,
	PageShellLoading,
	PageShellTitle,
} from "@/components/page-shell";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { CreateOrganizationDialog } from "./create-organization-dialog";
import { OrganizationsTable } from "./organizations-table";

export const metadata: Metadata = {
	title: "Organizations",
};

export default function AdminPage() {
	return (
		<PageShell>
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Organizations</PageShellTitle>
					<PageShellDescription>
						Every tenant on this install. Create one, invite its first owner,
						set its caps, suspend it, or look in.
					</PageShellDescription>
				</PageShellHeading>

				<PageShellActions>
					<CreateOrganizationDialog />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent>
				<Suspense fallback={<PageShellLoading />}>
					<Organizations />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Organizations() {
	await getServerQueryClient().prefetchQuery(
		getServerTrpc().admin.listOrganizations.queryOptions(),
	);

	return (
		<HydrateClient>
			<OrganizationsTable />
		</HydrateClient>
	);
}

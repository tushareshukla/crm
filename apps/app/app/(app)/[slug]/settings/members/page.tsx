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
import { requireSession } from "@/lib/session";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { InviteDialog } from "./invite-dialog";
import { membersSearchParams } from "./members-search-params";
import { MembersTable } from "./members-table";
import { PendingInvites } from "./pending-invites";

export const metadata: Metadata = {
	title: "Members",
};

export default function MembersSettingsPage({
	searchParams,
}: PageProps<"/[slug]/settings/members">) {
	return (
		<PageShell className="min-h-0">
			<PageShellHeader>
				<PageShellHeading>
					<PageShellTitle>Members</PageShellTitle>
					<PageShellDescription>
						Everyone who has access to your CRM. Invitations are links you send
						yourself.
					</PageShellDescription>
				</PageShellHeading>

				<PageShellActions>
					<InviteDialog />
				</PageShellActions>
			</PageShellHeader>

			<PageShellContent className="min-h-0">
				<Suspense fallback={<PageShellLoading />}>
					<Members searchParams={searchParams} />
				</Suspense>
			</PageShellContent>
		</PageShell>
	);
}

async function Members({
	searchParams,
}: Pick<PageProps<"/[slug]/settings/members">, "searchParams">) {
	await requireSession();

	const values = await membersSearchParams.load(searchParams);

	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	await Promise.all([
		queryClient.prefetchQuery(trpc.workspace.get.queryOptions()),
		queryClient.prefetchQuery(
			trpc.workspace.members.queryOptions(membersSearchParams.toInput(values)),
		),
	]);

	return (
		<HydrateClient>
			<PendingInvites />
			<MembersTable />
		</HydrateClient>
	);
}

import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { AppHeader, AppHeaderFallback } from "@/components/app-header";
import { AppIconRail, AppIconRailFallback } from "@/components/app-icon-rail";
import { QuickSwitcher } from "@/components/crm/quick-switcher";
import { RecordSheetHost } from "@/components/crm/record-sheet/record-sheet-host";
import { MobileNavProvider } from "@/components/mobile-nav";
import { loadOrganization } from "@/lib/organization";
import { requireMailboxAccess } from "@/lib/session";
import { OrgQueryScope } from "@/lib/trpc/client";
import { HydrateClient } from "@/lib/trpc/hydrate";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { SuspendedOrganization } from "./suspended-organization";

export default function AppLayout({
	children,
	params,
}: LayoutProps<"/[slug]">) {
	// The shell's skeleton is static; who is signed in and which organization
	// the URL names stream in behind it.
	return (
		<Suspense fallback={<AppShellFallback />}>
			<OrganizationShell params={params}>{children}</OrganizationShell>
		</Suspense>
	);
}

async function OrganizationShell({
	children,
	params,
}: Pick<LayoutProps<"/[slug]">, "params"> & { children: ReactNode }) {
	await connection();
	const [{ user }, { slug }] = await Promise.all([
		requireMailboxAccess(),
		params,
	]);

	// The URL decides the organization. An address the rep may not see — no
	// such organization, or not a member — is simply not found.
	const organization = await loadOrganization(slug);
	if (!organization) notFound();

	if (organization.status === "SUSPENDED") {
		return (
			<SuspendedOrganization
				organization={{ name: organization.name, slug: organization.slug }}
				user={{ email: user.email }}
			/>
		);
	}

	const header = {
		user: { name: user.name, email: user.email, image: user.image ?? null },
		organization: {
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			supportMode: organization.supportMode,
		},
	};

	return (
		<OrgQueryScope slug={organization.slug}>
			<MobileNavProvider>
				<div className="isolate flex h-svh flex-col">
					<Suspense fallback={<AppHeaderFallback />}>
						<WorkspaceHeader {...header} />
					</Suspense>

					<div className="flex min-h-0 flex-1">
						<Suspense fallback={<AppIconRailFallback />}>
							<AppIconRail />
						</Suspense>
						{children}
					</div>

					<Suspense fallback={null}>
						<RecordSheetHost />
					</Suspense>

					<Suspense fallback={null}>
						<QuickSwitcher />
					</Suspense>
				</div>
			</MobileNavProvider>
		</OrgQueryScope>
	);
}

function AppShellFallback() {
	return (
		<div className="isolate flex h-svh flex-col">
			<AppHeaderFallback />
			<div className="flex min-h-0 flex-1">
				<AppIconRailFallback />
			</div>
		</div>
	);
}

async function WorkspaceHeader(props: Parameters<typeof AppHeader>[0]) {
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	// The switcher and the account menu read these on the client; warming them
	// here means the header renders settled rather than popping in.
	await Promise.allSettled([
		queryClient.prefetchQuery(trpc.orgs.mine.queryOptions()),
		queryClient.prefetchQuery(trpc.users.me.queryOptions()),
	]);

	return (
		<HydrateClient>
			<AppHeader {...props} />
		</HydrateClient>
	);
}

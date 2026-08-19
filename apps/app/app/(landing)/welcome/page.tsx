import type { Metadata } from "next";
import { redirect, unstable_rethrow } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { SignOutButton } from "@/components/sign-out-button";
import { homePath, WELCOME_PATH } from "@/lib/home";
import { requireSession } from "@/lib/session";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";

export const metadata: Metadata = {
	title: "Welcome",
};

export const instant = false;

/**
 * Signed in, but a member of nowhere. Tenancy is invite-only: there is
 * nothing to create here, only an invitation to wait for.
 */
export default async function WelcomePage() {
	const { user } = await requireSession();

	const home = await readHome();

	// Someone who does belong somewhere (or runs the platform) has a home.
	if (home && home !== WELCOME_PATH) redirect(home);

	return (
		<AuthShell>
			<AuthHeading
				title="Invite-only"
				description="This CRM is invite-only. Ask an organization admin for an invitation link — opening it while signed in as this account adds you to their organization."
			/>

			<div className="flex flex-col gap-3">
				<p className="text-muted-foreground text-sm/5">
					You're signed in as{" "}
					<span className="font-medium text-foreground">{user.email}</span>.
					Invited under another address? Sign out and sign in with that one.
				</p>

				<SignOutButton className="w-full" variant="outline" />
			</div>
		</AuthShell>
	);
}

async function readHome(): Promise<string | null> {
	const trpc = getServerTrpc();
	const queryClient = getServerQueryClient();

	try {
		const [organizations, me] = await Promise.all([
			queryClient.fetchQuery(trpc.orgs.mine.queryOptions()),
			queryClient.fetchQuery(trpc.users.me.queryOptions()),
		]);

		return homePath({ platformAdmin: me.platformAdmin, organizations });
	} catch (error) {
		unstable_rethrow(error);
		console.error("Welcome: could not read the rep's organizations.", error);
		return null;
	}
}

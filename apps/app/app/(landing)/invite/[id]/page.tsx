import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { signInPath } from "@/lib/home";
import { getSession } from "@/lib/session";
import { AcceptInvitation } from "./accept-invitation";

export const metadata: Metadata = {
	title: "Invitation",
};

export const instant = false;

/**
 * The copy-link invitation lands here. A stranger goes through sign-in (or
 * sign-up) first and comes straight back; a signed-in rep is added to the
 * organization and sent into it.
 */
export default async function InvitePage({
	params,
}: PageProps<"/invite/[id]">) {
	const { id } = await params;
	const path = `/invite/${encodeURIComponent(id)}`;

	const session = await getSession();
	if (!session) redirect(signInPath(path));

	return (
		<AuthShell>
			<AuthHeading
				title="Joining an organization"
				description="One moment — we are adding you to the organization that invited you."
			/>

			<AcceptInvitation
				invitationId={id}
				path={path}
				email={session.user.email}
			/>
		</AuthShell>
	);
}

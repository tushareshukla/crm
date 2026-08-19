import { Button } from "@crm/ui/components/button";
import Link from "next/link";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * What a member sees at `/<slug>` while the organization is suspended: the
 * API refuses every call inside it, so there is nothing to render behind
 * this page.
 */
export function SuspendedOrganization({
	organization,
	user,
}: {
	organization: { name: string; slug: string };
	user: { email: string };
}) {
	return (
		<AuthShell>
			<AuthHeading
				title="This organization is suspended"
				description={
					<>
						<span className="text-foreground">{organization.name}</span> (/
						{organization.slug}) has been suspended by the platform. Nobody can
						work in it until it is reinstated — ask whoever runs this install.
					</>
				}
			/>

			<div className="flex flex-col gap-3">
				<Button asChild className="w-full">
					<Link href="/">Back to home</Link>
				</Button>
				<SignOutButton className="w-full" variant="ghost" />
			</div>

			<p className="text-center text-muted-foreground text-sm/5">
				You are signed in as {user.email}.
			</p>
		</AuthShell>
	);
}

"use client";

import { Button } from "@crm/ui/components/button";
import { Spinner } from "@crm/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { useTRPC } from "@/lib/trpc/client";
import { workspaceUrl } from "@/lib/workspace-url";

export function AcceptInvitation({
	invitationId,
	path,
	email,
}: {
	invitationId: string;
	/** This page's own path, so sign-out can bring the rep straight back. */
	path: string;
	email: string;
}) {
	const trpc = useTRPC();

	const accept = useMutation(
		trpc.orgs.acceptInvitation.mutationOptions({
			onSuccess: ({ organization }) => {
				// A full navigation: the session's active organization just changed
				// and the organization's pages should start from a clean cache.
				window.location.assign(workspaceUrl(organization.slug));
			},
		}),
	);

	// Accept as soon as the page is up; the ref keeps a re-run of the effect
	// (development strict mode) from asking twice.
	const started = useRef(false);
	useEffect(() => {
		if (started.current) return;
		started.current = true;
		accept.mutate({ invitationId });
	}, [accept.mutate, invitationId]);

	if (accept.isError) {
		return (
			<div className="flex flex-col gap-4">
				<p className="text-destructive text-sm/5" role="alert">
					{accept.error.message || "That invitation could not be accepted."}
				</p>
				<p className="text-muted-foreground text-sm/5">
					You are signed in as{" "}
					<span className="font-medium text-foreground">{email}</span>. An
					invitation only works for the address it was sent to, once, and before
					it expires.
				</p>

				<div className="flex flex-col gap-2">
					<Button
						type="button"
						className="w-full"
						onClick={() => accept.mutate({ invitationId })}
					>
						Try again
					</Button>
					<SignOutButton className="w-full" variant="outline" next={path}>
						Sign out and use another account
					</SignOutButton>
					<Button asChild variant="ghost" className="w-full">
						<Link href="/">Go to my organizations</Link>
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div
			className="flex items-center gap-2 text-muted-foreground text-sm/5"
			role="status"
		>
			<Spinner />
			{accept.isSuccess ? "Opening the organization…" : "Accepting…"}
		</div>
	);
}

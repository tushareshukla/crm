"use client";

import { Button } from "@crm/ui/components/button";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { signOutAndRedirect } from "@/lib/sign-out";

/** Sign out and land on the sign-in page — coming back to `next` afterwards when given. */
export function SignOutButton({
	next,
	children = "Sign out",
	...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "type"> & {
	next?: string;
}) {
	return (
		<Button
			type="button"
			onClick={() => {
				signOutAndRedirect(next).catch(() =>
					toast.error("Could not sign out."),
				);
			}}
			{...props}
		>
			{children}
		</Button>
	);
}

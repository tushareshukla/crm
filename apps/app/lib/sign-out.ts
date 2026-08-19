"use client";

import { signOut } from "@crm/auth/client";
import { toast } from "sonner";
import { signInPath } from "@/lib/home";

/** Sign out and land on the sign-in page — remembering `next` when there is somewhere to come back to. */
export async function signOutAndRedirect(next?: string) {
	const { error } = await signOut();

	if (error) {
		toast.error(error.message ?? "Could not sign out.");
		return;
	}

	window.location.assign(signInPath(next));
}

"use client";

import { signIn, signUp } from "@crm/auth/client";
import { Button } from "@crm/ui/components/button";
import { Input } from "@crm/ui/components/input";
import { Label } from "@crm/ui/components/label";
import { Spinner } from "@crm/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Fork addition: email + password sign-in (and first-run sign-up) so a
 * self-hosted install works without a Google/Microsoft OAuth client. Who may
 * create an account is still decided by ALLOWED_SIGN_IN on the API.
 */
export function PasswordSignIn() {
	const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
	const [pending, setPending] = useState(false);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const email = String(form.get("email") ?? "").trim();
		const password = String(form.get("password") ?? "");
		const name = String(form.get("name") ?? "").trim();
		if (!email || !password) return;

		setPending(true);
		const origin = window.location.origin;
		const callbackURL = `${origin}/`;

		const { error } =
			mode === "sign-up"
				? await signUp.email({
						email,
						password,
						name: name || email.split("@")[0] || email,
						callbackURL,
					})
				: await signIn.email({ email, password, callbackURL });

		if (error) {
			setPending(false);
			toast.error(error.message ?? "Could not sign in.");
			return;
		}

		window.location.assign(callbackURL);
	}

	return (
		<form
			className="flex w-full flex-col gap-3"
			onSubmit={(event) => {
				handleSubmit(event).catch(() => {
					setPending(false);
					toast.error("Could not reach the sign-in service.");
				});
			}}
		>
			{mode === "sign-up" ? (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="name">Name</Label>
					<Input autoComplete="name" id="name" name="name" />
				</div>
			) : null}
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="email">Email</Label>
				<Input
					autoComplete="email"
					id="email"
					name="email"
					required
					type="email"
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="password">Password</Label>
				<Input
					autoComplete={
						mode === "sign-up" ? "new-password" : "current-password"
					}
					id="password"
					minLength={12}
					name="password"
					required
					type="password"
				/>
			</div>
			<Button className="w-full" disabled={pending} type="submit">
				{pending ? <Spinner data-icon="inline-start" /> : null}
				{mode === "sign-up" ? "Create account" : "Sign in"}
			</Button>
			<button
				className="text-center text-muted-foreground text-sm/5 underline-offset-4 hover:underline"
				onClick={() => setMode(mode === "sign-up" ? "sign-in" : "sign-up")}
				type="button"
			>
				{mode === "sign-up"
					? "Already have an account? Sign in"
					: "First time here? Create an account"}
			</button>
		</form>
	);
}

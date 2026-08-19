"use client";

import { Avatar, AvatarFallback } from "@crm/ui/components/avatar";
import { Badge } from "@crm/ui/components/badge";
import Logo from "@crm/ui/components/logo";
import { Separator } from "@crm/ui/components/separator";
import Link from "next/link";
import { toast } from "sonner";
import { UserMenu } from "@/components/app-header";
import { signOutAndRedirect } from "@/lib/sign-out";

export function ConsoleHeader({
	user,
}: {
	user: { name: string; email: string; image: string | null };
}) {
	return (
		<header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
			<div className="flex min-w-0 shrink-0 items-center gap-1">
				<Link
					href="/"
					aria-label="My organizations"
					className="flex size-8 items-center justify-center text-foreground"
				>
					<Logo className="size-5" />
				</Link>
				<Separator orientation="vertical" className="mx-1 h-5 bg-transparent" />
				<span className="min-w-0 truncate font-medium text-sm">
					Platform console
				</span>
				<Badge variant="outline" className="ml-1">
					Admin
				</Badge>
			</div>

			<div className="ml-auto flex shrink-0 items-center gap-1.5">
				<UserMenu
					user={user}
					onSignOut={() => {
						signOutAndRedirect().catch(() =>
							toast.error("Could not sign out."),
						);
					}}
				/>
			</div>
		</header>
	);
}

export function ConsoleHeaderFallback() {
	return (
		<header
			className="flex h-12 shrink-0 items-center gap-2 border-b px-3"
			aria-busy="true"
		>
			<div className="flex min-w-0 shrink-0 items-center gap-1">
				<span className="flex size-8 items-center justify-center text-foreground">
					<Logo className="size-5" />
				</span>
				<Separator orientation="vertical" className="mx-1 h-5 bg-transparent" />
				<span className="min-w-0 truncate font-medium text-sm">
					Platform console
				</span>
			</div>

			<div className="ml-auto flex shrink-0 items-center gap-1.5">
				<Avatar className="size-7">
					<AvatarFallback />
				</Avatar>
			</div>
			<span role="status" className="sr-only">
				Loading the console…
			</span>
		</header>
	);
}

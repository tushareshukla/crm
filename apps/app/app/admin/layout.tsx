import type { Metadata } from "next";
import { notFound, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { requireSession } from "@/lib/session";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import { ConsoleHeader, ConsoleHeaderFallback } from "./console-header";

export const metadata: Metadata = {
	title: {
		default: "Platform console",
		template: "%s · Platform console",
	},
};

/**
 * The platform console: platform admins only. Everyone else gets the same
 * not-found page as for any address that is not theirs, so the console's
 * existence is not advertised.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
	return (
		<Suspense fallback={<ConsoleShellFallback />}>
			<ConsoleShell>{children}</ConsoleShell>
		</Suspense>
	);
}

async function ConsoleShell({ children }: { children: ReactNode }) {
	await connection();
	const { user } = await requireSession();

	if (!(await isPlatformAdmin())) notFound();

	return (
		<div className="isolate flex h-svh flex-col">
			<ConsoleHeader
				user={{ name: user.name, email: user.email, image: user.image ?? null }}
			/>
			<div className="flex min-h-0 flex-1">{children}</div>
		</div>
	);
}

function ConsoleShellFallback() {
	return (
		<div className="isolate flex h-svh flex-col">
			<ConsoleHeaderFallback />
			<div className="flex min-h-0 flex-1" />
		</div>
	);
}

async function isPlatformAdmin(): Promise<boolean> {
	try {
		const me = await getServerQueryClient().fetchQuery(
			getServerTrpc().users.me.queryOptions(),
		);
		return me.platformAdmin;
	} catch (error) {
		unstable_rethrow(error);
		console.error("Console: could not read who is signed in.", error);
		return false;
	}
}

"use client";

import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import {
	createTRPCContext,
	type TRPCOptionsProxy,
} from "@trpc/tanstack-react-query";
import type { AppRouter } from "api/app-router";
import type { FC, ReactNode } from "react";
import { useState } from "react";
import { orgSlugHeaders } from "@/lib/org-slug";
import { getQueryClient } from "./query-client";

const { TRPCProvider: ContextProvider, useTRPC: useTRPCContext } =
	createTRPCContext<AppRouter>();

const TRPCProvider: FC<{
	children: ReactNode;
	queryClient: QueryClient;
	trpcClient: TRPCClient<AppRouter>;
	keyPrefix?: never;
}> = ContextProvider;

export const useTRPC: () => TRPCOptionsProxy<AppRouter> = useTRPCContext;

function makeTrpcClient(): TRPCClient<AppRouter> {
	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: "/api/trpc",
				// Read at request time rather than once: the same client serves
				// every organization the rep moves between, and every call names
				// the organization of the page it is made from.
				headers: () => orgSlugHeaders(window.location.pathname),
			}),
		],
	});
}

function Providers({
	scope,
	children,
}: {
	scope: string;
	children: ReactNode;
}) {
	const queryClient = getQueryClient(scope);
	const [trpcClient] = useState(makeTrpcClient);

	return (
		<QueryClientProvider client={queryClient}>
			<TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
				{children}
			</TRPCProvider>
		</QueryClientProvider>
	);
}

/**
 * The app-wide providers: the cache the app's own routes (sign-in, admin,
 * welcome…) share. Organization pages sit inside an `OrgQueryScope` below,
 * which gives each organization a cache of its own.
 */
export function TRPCReactProvider({ children }: { children: ReactNode }) {
	return (
		<Providers scope="">
			{children}
			{process.env.NODE_ENV === "development" ? (
				<ReactQueryDevtools initialIsOpen={false} />
			) : null}
		</Providers>
	);
}

/**
 * One cache per organization. Query keys are procedure + input and carry no
 * organization, so a shared cache would hand `/acme`'s contacts to `/globex`
 * for a moment after switching. The `[slug]` layouts render this with the
 * slug they resolved, so everything under them reads and writes that
 * organization's cache and nothing else's.
 */
export function OrgQueryScope({
	slug,
	children,
}: {
	slug: string;
	children: ReactNode;
}) {
	return <Providers scope={slug}>{children}</Providers>;
}

"use client";

import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import {
	createTRPCContext,
	type TRPCOptionsProxy,
} from "@trpc/tanstack-react-query";
import type { AppRouter } from "api/app-router";
import { useParams } from "next/navigation";
import type { FC, ReactNode } from "react";
import { useState } from "react";
import { orgSlugFromPathname, orgSlugHeaders } from "@/lib/org-slug";
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

export function TRPCReactProvider({ children }: { children: ReactNode }) {
	// The organization is whatever the URL says it is, so the cache follows
	// the `[slug]` segment: a fresh one per organization, one shared cache for
	// the app's own routes.
	const params = useParams<{ slug?: string }>();
	const scope = orgSlugFromPathname(`/${params?.slug ?? ""}`) ?? "";
	const queryClient = getQueryClient(scope);

	const [trpcClient] = useState(() =>
		createTRPCClient<AppRouter>({
			links: [
				httpBatchLink({
					url: "/api/trpc",
					// Read at request time rather than once: the same client serves
					// every organization the rep moves between.
					headers: () => orgSlugHeaders(window.location.pathname),
				}),
			],
		}),
	);

	return (
		<QueryClientProvider client={queryClient}>
			<TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
				{children}
				{process.env.NODE_ENV === "development" ? (
					<ReactQueryDevtools initialIsOpen={false} />
				) : null}
			</TRPCProvider>
		</QueryClientProvider>
	);
}

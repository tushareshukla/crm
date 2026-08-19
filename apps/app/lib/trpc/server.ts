import "server-only";
import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import {
	createTRPCOptionsProxy,
	type TRPCOptionsProxy,
} from "@trpc/tanstack-react-query";
import type { AppRouter } from "api/app-router";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { API_URL } from "@/lib/env";
import { ORG_SLUG_HEADER } from "@/lib/org-slug";
import { makeQueryClient } from "./query-client";

export const getServerQueryClient = cache(makeQueryClient);

/**
 * The organization this request is for. The proxy stamps `x-org-slug` onto
 * every request under `/<slug>/…` from the pathname, which is the one place a
 * server component can learn which segment it is rendering under.
 */
export async function requestOrgSlug(): Promise<string | null> {
	const slug = (await headers()).get(ORG_SLUG_HEADER)?.trim().toLowerCase();

	return slug ? slug : null;
}

export function getServerTrpcClient(): TRPCClient<AppRouter> {
	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `${API_URL}/api/trpc`,
				headers: async () => {
					const [cookie, slug] = await Promise.all([
						cookies().then((store) => store.toString()),
						requestOrgSlug(),
					]);

					const requestHeaders = new Headers();
					if (cookie) requestHeaders.set("cookie", cookie);
					if (slug) requestHeaders.set(ORG_SLUG_HEADER, slug);

					return requestHeaders;
				},
			}),
		],
	});
}

export function getServerTrpc(): TRPCOptionsProxy<AppRouter> {
	const client = getServerTrpcClient();

	return createTRPCOptionsProxy<AppRouter>({
		client,
		queryClient: getServerQueryClient,
	});
}

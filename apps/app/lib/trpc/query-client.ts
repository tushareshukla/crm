import { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

const queryFailure = z
	.object({
		data: z
			.object({ httpStatus: z.number().nullable().catch(null) })
			.catch({ httpStatus: null }),
	})
	.catch({ data: { httpStatus: null } });

export function makeQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: { staleTime: 30_000, retry: retryQuery },
		},
	});
}

function retryQuery(failureCount: number, error: Error): boolean {
	const { httpStatus } = queryFailure.parse(error).data;

	if (httpStatus !== null && httpStatus >= 400 && httpStatus < 500) {
		return false;
	}

	return failureCount < 1;
}

/**
 * One cache per organization in the browser. Query keys are procedure + input
 * and carry no organization, so a single cache would hand `/acme`'s contacts
 * to `/globex` for a moment after switching. Keying the client by the slug in
 * the URL keeps each organization's data in its own cache; the app's own
 * routes (sign-in, admin, welcome…) share the unscoped one.
 */
const browserQueryClients = new Map<string, QueryClient>();

export function getQueryClient(scope = ""): QueryClient {
	if (globalThis.window === undefined) {
		return makeQueryClient();
	}

	let client = browserQueryClients.get(scope);
	if (!client) {
		client = makeQueryClient();
		browserQueryClients.set(scope, client);
	}
	return client;
}

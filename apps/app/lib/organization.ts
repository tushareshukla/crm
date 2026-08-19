import "server-only";
import { TRPCClientError } from "@trpc/client";
import { cache } from "react";
import { getServerQueryClient, getServerTrpc } from "@/lib/trpc/server";
import type { RouterOutputs } from "@/lib/trpc/types";

export type Organization = RouterOutputs["orgs"]["get"];

/** Errors that mean "there is no such organization for you", not "something broke". */
const NOT_FOR_YOU = new Set(["NOT_FOUND", "FORBIDDEN", "BAD_REQUEST"]);

/**
 * The organization at `slug` as the signed-in rep sees it — null when there
 * is none they may see (unknown address, not a member, malformed slug). One
 * read per request: the layout, the header and the pages all share it.
 */
export const loadOrganization = cache(
	async (slug: string): Promise<Organization | null> => {
		try {
			return await getServerQueryClient().fetchQuery(
				getServerTrpc().orgs.get.queryOptions({ slug }),
			);
		} catch (error) {
			if (
				error instanceof TRPCClientError &&
				NOT_FOR_YOU.has(String(error.data?.code))
			) {
				return null;
			}
			throw error;
		}
	},
);

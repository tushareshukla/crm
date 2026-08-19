import type { NextRequest } from "next/server";
import { z } from "zod";
import { API_URL } from "@/lib/env";
import type { Home } from "@/lib/home";
import { ORG_SLUG_HEADER } from "@/lib/org-slug";

const GATE_TIMEOUT_MS = 2_000;

export type Gate = "settled" | "required" | "unknown";

const procedureResult = z
	.object({ result: z.object({ data: z.json() }).catch({ data: null }) })
	.catch({ result: { data: null } });

const workspaceAnswer = z
	.object({
		onboarded: z.boolean().nullable().catch(null),
		canRename: z.boolean().nullable().catch(null),
		slug: z.string().min(1).nullable().catch(null),
		supportMode: z.boolean().catch(false),
	})
	.catch({ onboarded: null, canRename: null, slug: null, supportMode: false });

const researchKeyAnswer = z
	.object({ configured: z.boolean().nullable().catch(null) })
	.catch({ configured: null });

const meAnswer = z
	.object({ platformAdmin: z.boolean().catch(false) })
	.catch({ platformAdmin: false });

const mineAnswer = z
	.array(
		z.object({
			slug: z.string().min(1),
			status: z.string().catch("ACTIVE"),
		}),
	)
	.nullable()
	.catch(null);

async function read(
	request: NextRequest,
	procedure: string,
	slug: string | null = null,
) {
	const cookie = request.headers.get("cookie");

	if (!cookie) return null;

	try {
		const response = await fetch(`${API_URL}/api/trpc/${procedure}`, {
			headers: { cookie, ...(slug ? { [ORG_SLUG_HEADER]: slug } : {}) },
			cache: "no-store",
			signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
		});

		if (!response.ok) return null;

		return procedureResult.parse(await response.json()).result.data;
	} catch {
		return null;
	}
}

export type WorkspaceGate = {
	gate: Gate;
	slug: string | null;
	/** A platform admin looking in: setup is not theirs to answer. */
	supportMode: boolean;
};

/** Has the organization at `slug` been named? Asked with the slug so the answer is about that organization. */
export async function readWorkspaceGate(
	request: NextRequest,
	slug: string | null = null,
): Promise<WorkspaceGate> {
	const workspace = workspaceAnswer.parse(
		await read(request, "workspace.get", slug),
	);

	if (workspace.onboarded === null) {
		return { gate: "unknown", slug: workspace.slug, supportMode: false };
	}

	return {
		gate:
			workspace.onboarded ||
			workspace.canRename !== true ||
			workspace.supportMode
				? "settled"
				: "required",
		slug: workspace.slug,
		supportMode: workspace.supportMode,
	};
}

export async function readResearchGate(
	request: NextRequest,
	slug: string | null = null,
): Promise<Gate> {
	const { configured } = researchKeyAnswer.parse(
		await read(request, "settings.researchKey", slug),
	);

	if (configured === null) return "unknown";

	return configured ? "settled" : "required";
}

/**
 * Who the signed-in rep is to the platform and which organizations they
 * belong to — what `/` needs to send them somewhere. Null when the API could
 * not say (the caller fails open).
 */
export async function readHome(request: NextRequest): Promise<Home | null> {
	const [organizations, me] = await Promise.all([
		read(request, "orgs.mine").then((data) => mineAnswer.parse(data)),
		read(request, "users.me").then((data) => meAnswer.parse(data)),
	]);

	if (organizations === null) return null;

	return { platformAdmin: me.platformAdmin, organizations };
}

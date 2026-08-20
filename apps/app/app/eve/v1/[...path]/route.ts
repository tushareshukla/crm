import { OrgStatus, runWithTenant } from "@crm/db";
import { connection } from "next/server";
import {
	AGENT_URL,
	bridgeConfigured,
	mintBridgeToken,
} from "@/lib/agent-bridge";
import { bridgeRefused, sessionFromPath } from "@/lib/agent-bridge-guard";
import { ORG_SLUG_HEADER } from "@/lib/org-slug";
import {
	organizationAccess,
	requestedOrgSlug,
} from "@/lib/organization-access";
import { getSession } from "@/lib/session";

async function handler(request: Request): Promise<Response> {
	await connection();

	if (!bridgeConfigured()) {
		return Response.json(
			{ error: "The research agent is not configured for this install." },
			{ status: 503 },
		);
	}

	const session = await getSession();
	if (!session) {
		return Response.json({ error: "Not signed in." }, { status: 401 });
	}

	// The organization decides what the agent may see; a request that names
	// none gets nothing rather than an unscoped session.
	const slug = requestedOrgSlug(request);
	if (!slug) {
		return Response.json(
			{ error: "The request names no organization." },
			{ status: 403 },
		);
	}

	const organization = await organizationAccess(session.user, slug);
	if (!organization) {
		return Response.json(
			{ error: "No organization with that address." },
			{ status: 404 },
		);
	}
	if (organization.status === OrgStatus.SUSPENDED) {
		return Response.json(
			{ error: "This organization is suspended." },
			{ status: 403 },
		);
	}

	const url = new URL(request.url);
	const target = `${AGENT_URL}${url.pathname}${url.search}`;

	const headers = new Headers(request.headers);

	for (const header of [
		"host",
		"cookie",
		"x-forwarded-host",
		"x-forwarded-proto",
		"x-forwarded-for",
		"forwarded",
		"transfer-encoding",
		"connection",
		"keep-alive",
		"content-length",
		"expect",
	]) {
		headers.delete(header);
	}

	const contactId = request.headers.get("x-crm-contact");
	const companyId = request.headers.get("x-crm-company");
	const dealId = request.headers.get("x-crm-deal");
	const builderConversationId = request.headers.get(
		"x-crm-builder-conversation",
	);
	const requestedSession = sessionFromPath(url.pathname);
	headers.delete("x-crm-contact");
	headers.delete("x-crm-company");
	headers.delete("x-crm-deal");
	headers.delete("x-crm-builder-conversation");

	// Conversations are tenant rows: read them inside the organization, so a
	// session id from another organization is simply not found — and not found
	// is refused, never allowed through.
	const refused = await runWithTenant(organization.id, () =>
		bridgeRefused({
			userId: session.user.id,
			requestedSession,
			builderConversationId,
		}),
	);

	if (refused) {
		return Response.json({ error: "Conversation not found." }, { status: 404 });
	}

	headers.set(
		"authorization",
		`Bearer ${await mintBridgeToken(
			{
				id: session.user.id,
				email: session.user.email,
				name: session.user.name,
			},
			{
				organizationId: organization.id,
				contactId: cuid(contactId),
				companyId: cuid(companyId),
				dealId: cuid(dealId),
			},
		)}`,
	);
	headers.set(ORG_SLUG_HEADER, organization.slug);

	const init: RequestInit & { duplex?: "half" } = {
		method: request.method,
		headers,
		redirect: "manual",
		signal: request.signal,
	};

	if (request.method !== "GET" && request.method !== "HEAD") {
		init.body = request.body;
		init.duplex = "half";
	}

	let upstream: Response;
	try {
		upstream = await fetch(target, init);
	} catch (error) {
		return Response.json(
			{
				error: "The research agent is not reachable.",
				detail: error instanceof Error ? error.message : String(error),
			},
			{ status: 502 },
		);
	}

	const responseHeaders = new Headers(upstream.headers);
	for (const header of [
		"transfer-encoding",
		"connection",
		"content-encoding",
		"content-length",
	]) {
		responseHeaders.delete(header);
	}

	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders,
	});
}

export {
	handler as DELETE,
	handler as GET,
	handler as HEAD,
	handler as OPTIONS,
	handler as PATCH,
	handler as POST,
	handler as PUT,
};

function cuid(value: string | null): string | undefined {
	return value && /^[a-z0-9]{20,32}$/.test(value) ? value : undefined;
}

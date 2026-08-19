import type { Db } from "./client";
import {
	type JsonValue,
	jsonObject,
	jsonText,
	type WorkspaceProfileSections,
} from "./json";

import { currentTenantId } from "./tenant";

/** The current organization id (the tenant). WorkspaceProfile.id equals it. */
export function workspaceId(): string {
	return currentTenantId();
}

// Pure rules (slug, onboarding metadata) are client-safe and live in ./workspace-rules.
export {
	DEFAULT_WORKSPACE_SLUG,
	isOnboarded,
	MAX_LINE,
	MAX_NARRATIVE,
	MAX_SLUG,
	markOnboarded,
	RESERVED_SLUGS,
	workspaceSlug,
} from "./workspace-rules";

import { MAX_LINE, MAX_NARRATIVE } from "./workspace-rules";

export type WorkspaceProfile = {
	website: string;
	narrative: string;
	sections: WorkspaceProfileSections;
	sourceUrl: string | null;
	refreshedAt: Date;
};

export type WorkspaceIdentity = {
	name: string;
	website: string | null;
	profile: WorkspaceProfile | null;
};

export async function readWorkspaceProfile(
	db: Db,
): Promise<WorkspaceProfile | null> {
	const row = await db.workspaceProfile.findUnique({
		where: { id: workspaceId() },
		select: {
			website: true,
			narrative: true,
			sections: true,
			sourceUrl: true,
			refreshedAt: true,
		},
	});

	if (!row) return null;

	return { ...row, sections: readSections(row.sections) };
}

export function websiteUrl(website: string | null | undefined): string | null {
	const trimmed = website?.trim();
	if (!trimmed) return null;

	const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)?.[1];
	if (scheme && !/^https?$/i.test(scheme)) return null;

	let url: URL;
	try {
		url = new URL(scheme ? trimmed : `https://${trimmed}`);
	} catch {
		return null;
	}

	if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(url.hostname)) return null;

	const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");

	return `${url.protocol}//${url.hostname}${path}`;
}

export function profileOf(
	profile: WorkspaceProfile | null,
	website: string | null,
): WorkspaceProfile | null {
	if (!profile || !website || profile.website !== website) return null;

	return profile;
}

export async function readWorkspaceIdentity(
	db: Db,
): Promise<WorkspaceIdentity | null> {
	const [workspace, profile] = await Promise.all([
		db.organization.findUnique({
			where: { id: workspaceId() },
			select: { name: true, website: true },
		}),
		readWorkspaceProfile(db),
	]);

	if (!workspace) return null;

	return {
		name: workspace.name,
		website: workspace.website,
		profile: profileOf(profile, workspace.website),
	};
}

export async function writeWorkspaceProfile(
	db: Db,
	input: {
		website: string;
		narrative: string;
		sections: WorkspaceProfileSections;
		sourceUrl?: string | null;
		sessionId?: string | null;
	},
): Promise<WorkspaceProfile> {
	const fields = {
		website: input.website,
		narrative: clamp(input.narrative, MAX_NARRATIVE) ?? "",
		sections: trimSections(input.sections),
		sourceUrl: input.sourceUrl ?? null,
		sessionId: input.sessionId ?? null,
		refreshedAt: new Date(),
	};

	const row = await db.workspaceProfile.upsert({
		where: { id: workspaceId() },
		create: { id: workspaceId(), ...fields },
		update: fields,
		select: {
			website: true,
			narrative: true,
			sections: true,
			sourceUrl: true,
			refreshedAt: true,
		},
	});

	return { ...row, sections: readSections(row.sections) };
}

export function trimSections(
	sections: WorkspaceProfileSections,
): WorkspaceProfileSections {
	const trimmed: WorkspaceProfileSections = {};

	const sells = clamp(sections.sells, MAX_LINE);
	if (sells) trimmed.sells = sells;

	const sellsTo = clamp(sections.sellsTo, MAX_LINE);
	if (sellsTo) trimmed.sellsTo = sellsTo;

	const edge = clamp(sections.edge, MAX_LINE);
	if (edge) trimmed.edge = edge;

	return trimmed;
}

function clamp(value: string | undefined, max: number): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;

	return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function readSections(value: JsonValue): WorkspaceProfileSections {
	const record = jsonObject(value);
	const text = (key: string) => jsonText(record[key])?.trim() || undefined;

	return trimSections({
		sells: text("sells"),
		sellsTo: text("sellsTo"),
		edge: text("edge"),
	});
}

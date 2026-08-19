/**
 * HTTP helpers for the API suite: boot the real Nest application, sign users
 * up through better-auth (so the invite-only gate and the session hooks are
 * the real ones) and call tRPC procedures over supertest with a session
 * cookie and the `x-org-slug` header the app sends.
 *
 * Nothing here touches tenant data directly; fixtures go through ./tenant.
 */
import { auth } from "@crm/auth";
import { db, withoutTenant } from "@crm/db";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { INestApplication } from "@nestjs/common";
import type { Cache } from "cache-manager";
import request, { type Response } from "supertest";
import { ORG_SLUG_HEADER } from "./tenant";

export const PASSWORD = "correct-horse-battery-staple";

/** The automatic backfill's cache key (see BackfillService.auto). */
const BACKFILL_AUTO_KEY = "backfill:auto";

const HOUR_MS = 60 * 60_000;

/**
 * Boot the API exactly as `main.ts` does. Signing in kicks off the automatic
 * backfill sweep across every organization; its cache key is pinned so the
 * sweep stays out of the tests.
 */
export async function startApp(): Promise<INestApplication> {
	const { createApp } = await import("../src/create-app");
	const app = await createApp();
	await app.init();
	await app.get<Cache>(CACHE_MANAGER).set(BACKFILL_AUTO_KEY, true, HOUR_MS);
	return app;
}

export type TestUser = {
	id: string;
	email: string;
	/** `cookie` header value carrying the session. */
	cookie: string;
};

/**
 * Create an account and a session through better-auth. The address must pass
 * the invite-only gate (platform admin, pending invitation, or ALLOWED_SIGN_IN).
 */
export async function signUp(email: string, name = email): Promise<TestUser> {
	const { headers, response } = await auth.api.signUpEmail({
		body: { email, password: PASSWORD, name },
		returnHeaders: true,
	});

	return { id: response.user.id, email, cookie: cookieOf(headers) };
}

/** A second session for an existing account. */
export async function signIn(email: string): Promise<TestUser> {
	const { headers, response } = await auth.api.signInEmail({
		body: { email, password: PASSWORD },
		returnHeaders: true,
	});

	return { id: response.user.id, email, cookie: cookieOf(headers) };
}

function cookieOf(headers: Headers): string {
	return headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0] ?? "")
		.filter(Boolean)
		.join("; ");
}

/** Delete every account whose address ends in `@domain` (sessions, accounts and memberships cascade). */
export async function deleteUsersAt(domain: string): Promise<void> {
	await withoutTenant(() =>
		db.user.deleteMany({
			where: { email: { endsWith: `@${domain}`, mode: "insensitive" } },
		}),
	);
}

export type CallOptions = {
	/** Session cookie; omit for an anonymous call. */
	as?: TestUser | null;
	/** Organization slug for `x-org-slug`; omit to send none. */
	org?: string | null;
};

function decorate<T extends request.Test>(req: T, options: CallOptions): T {
	if (options.as) req.set("cookie", options.as.cookie);
	if (options.org) req.set(ORG_SLUG_HEADER, options.org);
	return req;
}

/** `GET /api/trpc/<path>?input=…` */
export function query(
	app: INestApplication,
	path: string,
	input?: unknown,
	options: CallOptions = {},
): request.Test {
	const url =
		input === undefined
			? `/api/trpc/${path}`
			: `/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`;

	return decorate(request(app.getHttpServer()).get(url), options);
}

/** `POST /api/trpc/<path>` with a JSON body. */
export function mutate(
	app: INestApplication,
	path: string,
	input?: unknown,
	options: CallOptions = {},
): request.Test {
	const req = request(app.getHttpServer())
		.post(`/api/trpc/${path}`)
		.set("content-type", "application/json");

	return decorate(req, options).send(
		input === undefined ? "{}" : JSON.stringify(input),
	);
}

/** The procedure's result, or throw with the tRPC error when there is one. */
export function dataOf<T = unknown>(response: Response): T {
	const body = response.body as {
		result?: { data: T };
		error?: { message: string; data?: { code?: string } };
	};

	if (body.error) {
		throw new Error(
			`tRPC ${body.error.data?.code ?? "error"}: ${body.error.message} (HTTP ${response.status})`,
		);
	}

	if (!body.result) {
		throw new Error(
			`No tRPC result (HTTP ${response.status}): ${response.text.slice(0, 200)}`,
		);
	}

	return body.result.data;
}

export type TrpcFailure = { code: string; message: string; status: number };

/** The tRPC error of a failed call, or throw when the call succeeded. */
export function errorOf(response: Response): TrpcFailure {
	const body = response.body as {
		error?: { message: string; data?: { code?: string } };
	};

	if (!body.error) {
		throw new Error(
			`Expected a tRPC error, got HTTP ${response.status}: ${response.text.slice(0, 200)}`,
		);
	}

	return {
		code: body.error.data?.code ?? "UNKNOWN",
		message: body.error.message,
		status: response.status,
	};
}

/**
 * Point PLATFORM_ADMINS / ALLOWED_SIGN_IN at the test's own addresses for the
 * duration of a file. Returns the restore function for `afterAll`.
 */
export function useSignInEnv(values: {
	platformAdmins?: string[];
	allowedSignIn?: string[];
}): () => void {
	const before = {
		PLATFORM_ADMINS: process.env.PLATFORM_ADMINS,
		ALLOWED_SIGN_IN: process.env.ALLOWED_SIGN_IN,
	};

	process.env.PLATFORM_ADMINS = (values.platformAdmins ?? []).join(",");
	process.env.ALLOWED_SIGN_IN = (values.allowedSignIn ?? []).join(",");

	return () => {
		restore("PLATFORM_ADMINS", before.PLATFORM_ADMINS);
		restore("ALLOWED_SIGN_IN", before.ALLOWED_SIGN_IN);
	};
}

function restore(key: string, value: string | undefined): void {
	if (value === undefined) delete process.env[key];
	else process.env[key] = value;
}

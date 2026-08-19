import "@crm/env/load";

import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "./generated/prisma/client";
import {
	bindScope,
	captureScope,
	runInScope,
	type TenantScope,
} from "./tenant";
import { tenantScoping } from "./tenant-extension";

const connectionString =
	process.env.NODE_ENV === "test" ? testDatabase() : liveDatabase();

function liveDatabase(): string {
	const url = process.env.DATABASE_URL;

	if (!url) {
		throw new Error(
			"DATABASE_URL is not set. Copy .env.example to .env at the root of the repo and fill it in, or set DATABASE_URL in the environment.",
		);
	}

	return url;
}

function testDatabase(): string {
	const url = process.env.TEST_DATABASE_URL;

	if (!url) {
		throw new Error(
			[
				"TEST_DATABASE_URL is not set, and the suite will not fall back to DATABASE_URL.",
				"",
				"These are real integration tests. They delete every workspace member and the",
				"organization row and put them back when the run finishes — so a run that is",
				"interrupted leaves everybody locked out of whatever database it was pointed at.",
				"The pre-push hook runs them, so that is one `git push` away from a database you",
				"care about.",
				"",
				"Make a throwaway one and point TEST_DATABASE_URL at it:",
				"",
				"    bun run db:test",
				"",
			].join("\n"),
		);
	}

	if (!databaseName(url).endsWith("_test")) {
		throw new Error(
			`TEST_DATABASE_URL must name a database ending in _test, so it cannot be one somebody is using. It names "${databaseName(url)}".`,
		);
	}

	return url;
}

function databaseName(url: string): string {
	try {
		return new URL(url).pathname.replace(/^\//, "");
	} catch {
		return url;
	}
}

export interface PrismaLogRecord {
	level: Prisma.LogLevel;
	message: string;
	target: string;
	durationMs?: number;
}

export type PrismaLogSink = (record: PrismaLogRecord) => void;

const consoleSink: PrismaLogSink = ({ level, message, target, durationMs }) => {
	const suffix = durationMs === undefined ? "" : ` (+${durationMs}ms)`;
	const line = `[prisma:${level}] ${message}${suffix} [${target}]`;

	if (level === "error") {
		console.error(line);
	} else if (level === "warn") {
		console.warn(line);
	} else {
		console.log(line);
	}
};

let sink: PrismaLogSink = consoleSink;

export function setPrismaLogSink(next: PrismaLogSink | null): void {
	sink = next ?? consoleSink;
}

const logQueries = process.env.PRISMA_LOG_QUERIES === "true";

const logDefinitions: Prisma.LogDefinition[] = [
	{ level: "warn", emit: "event" },
	{ level: "error", emit: "event" },
	...(logQueries
		? ([
				{ level: "query", emit: "event" },
				{ level: "info", emit: "event" },
			] satisfies Prisma.LogDefinition[])
		: []),
];

const createPrismaClient = () => {
	const client = new PrismaClient({
		adapter: new PrismaPg({ connectionString }),
		log: logDefinitions,
	});

	client.$on("error", ({ message, target }) => {
		sink({ level: "error", message, target });
	});
	client.$on("warn", ({ message, target }) => {
		sink({ level: "warn", message, target });
	});
	client.$on("info", ({ message, target }) => {
		sink({ level: "info", message, target });
	});
	client.$on("query", ({ query, duration, target }) => {
		sink({ level: "query", message: query, target, durationMs: duration });
	});

	// Every query on a tenant model is scoped to the current tenant (see tenant.ts).
	const scoped = client.$extends(tenantScoping);
	return pinScopes(scoped) as typeof scoped;
};

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Prisma queries are lazy and the scoping extension runs when they execute.
 * Capture the tenant scope when a query is *built* and re-enter it when the
 * PrismaPromise is settled (`then` / `catch` / `finally`), so a query keeps its
 * tenant however it is later awaited — returned lazily from a `$transaction`
 * callback, collected into `Promise.all`, or built inside `runWithTenant` and
 * awaited outside it. Interactive transaction clients are pinned the same way.
 */
function pinScopes<T extends object>(target: T): T {
	const delegateCache = new WeakMap<object, object>();

	const pinPromise = (promise: unknown, scope: TenantScope): unknown => {
		if (
			typeof promise !== "object" ||
			promise === null ||
			typeof (promise as { then?: unknown }).then !== "function"
		)
			return promise;
		return new Proxy(promise as object, {
			get(p, prop, receiver) {
				const value = Reflect.get(p, prop, receiver);
				if (prop === "then" || prop === "catch" || prop === "finally") {
					return (...args: unknown[]) =>
						runInScope(scope, () => (value as AnyFn).apply(p, args));
				}
				// fluent relation accessors (`findUnique(…).company()`) build a new PrismaPromise
				if (typeof value === "function") {
					return (...args: unknown[]) =>
						pinPromise(
							runInScope(scope, () => (value as AnyFn).apply(p, args)),
							scope,
						);
				}
				return value;
			},
		});
	};

	const pinDelegate = (delegate: object): object => {
		const cached = delegateCache.get(delegate);
		if (cached) return cached;
		const proxied = new Proxy(delegate, {
			get(d, prop, receiver) {
				const value = Reflect.get(d, prop, receiver);
				if (typeof value !== "function") return value;
				return (...args: unknown[]) => {
					const scope = captureScope();
					return pinPromise(
						runInScope(scope, () => (value as AnyFn).apply(d, args)),
						scope,
					);
				};
			},
		});
		delegateCache.set(delegate, proxied);
		return proxied;
	};

	const isDelegate = (value: unknown): value is object =>
		typeof value === "object" &&
		value !== null &&
		typeof (value as { findMany?: unknown }).findMany === "function";

	return new Proxy(target, {
		get(t, property, receiver) {
			const value = Reflect.get(t, property, receiver);
			if (property === "$transaction") {
				const run = value as AnyFn;
				return (arg: unknown, options?: unknown) =>
					typeof arg === "function"
						? run.call(
								t,
								bindScope((tx: object) =>
									(arg as (tx: object) => unknown)(pinScopes(tx)),
								),
								options,
							)
						: run.call(t, arg, options);
			}
			if (
				typeof property === "string" &&
				!property.startsWith("$") &&
				isDelegate(value)
			) {
				return pinDelegate(value);
			}
			return value;
		},
	});
}

declare global {
	var prisma: ReturnType<typeof createPrismaClient> | undefined;
}

export const db = globalThis.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
	globalThis.prisma = db;
}

export type Db = typeof db;

/** The client handed to `db.$transaction(async (tx) => …)` — the extended client minus lifecycle methods. */
export type Tx = Omit<
	Db,
	"$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** Accepts either the shared client or a transaction client. */
export type DbLike = Db | Tx;

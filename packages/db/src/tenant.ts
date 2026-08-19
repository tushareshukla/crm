import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Tenant context. Every request, agent run, cron tick and collector hit runs
 * inside `runWithTenant(orgId, …)`; the Prisma tenant extension reads it and
 * scopes every query on a tenant model. Code that must see across tenants
 * (dispatch loops, auth hooks, admin console) opts out explicitly with
 * `withoutTenant`. Touching a tenant model with neither set throws — the
 * boundary fails closed.
 */
type Store =
	| { readonly kind: "tenant"; readonly organizationId: string }
	| { readonly kind: "bypass" };

const storage = new AsyncLocalStorage<Store>();

export class TenantContextMissing extends Error {
	constructor(model?: string, operation?: string) {
		super(
			`No tenant context${model ? ` for ${model}.${operation ?? "?"}` : ""}: wrap the call in runWithTenant(organizationId, …) or, for platform-level code, withoutTenant(…).`,
		);
		this.name = "TenantContextMissing";
	}
}

/**
 * Prisma queries are lazy: `db.x.findMany()` builds a PrismaPromise and the
 * extension runs when it is awaited. If `fn` returns a thenable we await it
 * *inside* the scope, so `runWithTenant(id, () => db.x.findMany())` and
 * `runWithTenant(id, async () => { … })` both stay scoped.
 */
function runScoped<T>(store: Store, fn: () => T): T {
	return storage.run(store, () => {
		const result = fn();
		if (isThenable(result)) {
			return (async () => (await result) as Awaited<T>)() as unknown as T;
		}
		return result;
	});
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

/** Opaque handle to the current scope, for `runInScope`. */
export type TenantScope = Store | undefined;

export function captureScope(): TenantScope {
	return storage.getStore();
}

/** Run `fn` inside a previously captured scope (no-op wrapper when there was none). */
export function runInScope<T>(scope: TenantScope, fn: () => T): T {
	return scope ? storage.run(scope, fn) : fn();
}

/**
 * Capture the current scope (tenant or bypass) and return a function that runs
 * `fn` inside it later — used to re-scope Prisma's `$transaction` callback, which
 * the runtime invokes from its own async chain.
 */
export function bindScope<A extends unknown[], R>(
	fn: (...args: A) => R,
): (...args: A) => R {
	const store = storage.getStore();
	if (!store) return fn;
	return (...args: A) => runScoped(store, () => fn(...args));
}

export function runWithTenant<T>(organizationId: string, fn: () => T): T {
	if (!organizationId) throw new TenantContextMissing();
	return runScoped({ kind: "tenant", organizationId }, fn);
}

/** Explicit cross-tenant mode for platform code. Audit every use. */
export function withoutTenant<T>(fn: () => T): T {
	return runScoped({ kind: "bypass" }, fn);
}

export function tenantIdOrNull(): string | null {
	const store = storage.getStore();
	return store?.kind === "tenant" ? store.organizationId : null;
}

export function currentTenantId(): string {
	const id = tenantIdOrNull();
	if (!id) throw new TenantContextMissing();
	return id;
}

export function isTenantBypassed(): boolean {
	return storage.getStore()?.kind === "bypass";
}

export function hasTenantContext(): boolean {
	return storage.getStore() !== undefined;
}

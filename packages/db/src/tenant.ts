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

export function runWithTenant<T>(organizationId: string, fn: () => T): T {
	if (!organizationId) throw new TenantContextMissing();
	return storage.run({ kind: "tenant", organizationId }, fn);
}

/** Explicit cross-tenant mode for platform code. Audit every use. */
export function withoutTenant<T>(fn: () => T): T {
	return storage.run({ kind: "bypass" }, fn);
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

import { Prisma } from "./generated/prisma/client";
import {
	TENANT_COMPOUND_UNIQUES,
	TENANT_LIST_RELATIONS,
	TENANT_MODELS,
	TENANT_RELATIONS,
	type TenantModel,
} from "./tenant-map.generated";
import {
	TenantContextMissing,
	isTenantBypassed,
	tenantIdOrNull,
} from "./tenant";

const TENANT = new Set<string>(TENANT_MODELS);
const isTenantModel = (model: string): model is TenantModel =>
	TENANT.has(model);

type AnyRecord = Record<string, unknown>;
const isObject = (v: unknown): v is AnyRecord =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const READ_WHERE = new Set([
	"findMany",
	"findFirst",
	"findFirstOrThrow",
	"count",
	"aggregate",
	"groupBy",
	"updateMany",
	"updateManyAndReturn",
	"deleteMany",
	"exists",
]);
const UNIQUE_WHERE = new Set([
	"findUnique",
	"findUniqueOrThrow",
	"update",
	"delete",
	"upsert",
]);

/** `where: { domain }` → `where: { organizationId_domain: { organizationId, domain } }` when `domain` used to be unique on its own. */
function compoundWhere(
	model: TenantModel,
	where: AnyRecord,
	org: string,
): AnyRecord {
	const out: AnyRecord = { ...where, organizationId: org };
	for (const key of TENANT_COMPOUND_UNIQUES[model]) {
		const others = key.filter((k) => k !== "organizationId");
		if (
			others.length === 1 &&
			others[0] &&
			others[0] in out &&
			!(key.join("_") in out)
		) {
			const field = others[0];
			const value = out[field];
			if (value === undefined || value === null || isObject(value)) continue;
			delete out[field];
			out[key.join("_")] = { organizationId: org, [field]: value };
		}
	}
	return out;
}

/** Inject organizationId into a create payload and recurse into nested relation writes. */
function scopeCreate(model: TenantModel, data: unknown, org: string): unknown {
	if (Array.isArray(data)) return data.map((d) => scopeCreate(model, d, org));
	if (!isObject(data)) return data;
	const out: AnyRecord = { ...data, organizationId: org };
	scopeNestedWrites(model, out, org);
	return out;
}

function scopeUpdateData(
	model: TenantModel,
	data: unknown,
	org: string,
): unknown {
	if (!isObject(data)) return data;
	const out: AnyRecord = { ...data };
	scopeNestedWrites(model, out, org);
	return out;
}

/** Walk relation fields of `model` and scope create / connectOrCreate / upsert / connect payloads. */
function scopeNestedWrites(
	model: TenantModel,
	data: AnyRecord,
	org: string,
): void {
	for (const [field, target] of Object.entries(TENANT_RELATIONS[model])) {
		const value = data[field];
		if (!isObject(value)) continue;
		const next: AnyRecord = { ...value };
		if ("create" in next) next.create = scopeCreate(target, next.create, org);
		if (isObject(next.createMany) && "data" in next.createMany)
			next.createMany = {
				...next.createMany,
				data: scopeCreate(target, next.createMany.data, org),
			};
		if ("connectOrCreate" in next) {
			const coc = next.connectOrCreate;
			const one = (c: unknown) =>
				isObject(c)
					? {
							...c,
							where: isObject(c.where)
								? compoundWhere(target, c.where, org)
								: c.where,
							create: scopeCreate(target, c.create, org),
						}
					: c;
			next.connectOrCreate = Array.isArray(coc) ? coc.map(one) : one(coc);
		}
		if ("upsert" in next) {
			const up = next.upsert;
			const one = (u: unknown) =>
				isObject(u)
					? {
							...u,
							...(isObject(u.where)
								? { where: compoundWhere(target, u.where, org) }
								: {}),
							create: scopeCreate(target, u.create, org),
							update: scopeUpdateData(target, u.update, org),
						}
					: u;
			next.upsert = Array.isArray(up) ? up.map(one) : one(up);
		}
		if ("update" in next) {
			const up = next.update;
			const one = (u: unknown) =>
				isObject(u) && ("where" in u || "data" in u)
					? {
							...u,
							...(isObject(u.where)
								? { where: compoundWhere(target, u.where, org) }
								: {}),
							data: scopeUpdateData(target, u.data, org),
						}
					: scopeUpdateData(target, u, org);
			next.update = Array.isArray(up) ? up.map(one) : one(up);
		}
		// connect / disconnect / set to a record of another org must fail: pin the org on the unique where.
		for (const op of ["connect", "disconnect", "set"] as const) {
			if (!(op in next)) continue;
			const v = next[op];
			const pin = (w: unknown) =>
				isObject(w) ? compoundWhere(target, w, org) : w;
			next[op] = Array.isArray(v)
				? v.map(pin)
				: typeof v === "boolean"
					? v
					: pin(v);
		}
		data[field] = next;
	}
}

/**
 * `include` / `select` of a list relation that points at a tenant model gets a
 * `where: { organizationId }` — this is what stops a read on a *global* model
 * (User, Organization) from pulling tenant rows across the boundary. Recurses
 * into nested include/select.
 */
function scopeSelection(
	model: string,
	selection: unknown,
	org: string,
): unknown {
	if (!isObject(selection)) return selection;
	const lists = TENANT_LIST_RELATIONS[model] ?? {};
	const nested = model in TENANT ? TENANT_RELATIONS[model as TenantModel] : {};
	const out: AnyRecord = { ...selection };
	for (const [field, value] of Object.entries(out)) {
		const listTarget = lists[field];
		const target = listTarget ?? nested?.[field];
		if (!target || value === false || value === undefined) continue;
		const args: AnyRecord = isObject(value) ? { ...value } : {};
		if (listTarget)
			args.where = {
				AND: [
					{ organizationId: org },
					...(isObject(args.where) ? [args.where] : []),
				],
			};
		if ("include" in args)
			args.include = scopeSelection(target, args.include, org);
		if ("select" in args)
			args.select = scopeSelection(target, args.select, org);
		out[field] = args;
	}
	return out;
}

function scopeSelections(model: string, a: AnyRecord, org: string): void {
	if ("include" in a) a.include = scopeSelection(model, a.include, org);
	if ("select" in a) a.select = scopeSelection(model, a.select, org);
}

/**
 * Prisma client extension that scopes every operation on a tenant model to
 * the current tenant. See packages/db/src/tenant.ts for the context API.
 */
export const tenantScoping = Prisma.defineExtension({
	name: "tenant-scoping",
	query: {
		$allModels: {
			async $allOperations({ model, operation, args, query }) {
				if (isTenantBypassed()) return query(args);
				const org = tenantIdOrNull();

				if (!isTenantModel(model)) {
					// Global model: only its selections of tenant lists need scoping — and only when a tenant is set.
					if (
						org &&
						isObject(args) &&
						("include" in args || "select" in args) &&
						model in TENANT_LIST_RELATIONS
					) {
						const a: AnyRecord = { ...args };
						scopeSelections(model, a, org);
						return query(a as typeof args);
					}
					return query(args);
				}
				if (!org) throw new TenantContextMissing(model, operation);

				const a: AnyRecord = isObject(args) ? { ...args } : {};
				scopeSelections(model, a, org);

				if (READ_WHERE.has(operation)) {
					a.where = {
						AND: [
							{ organizationId: org },
							...(isObject(a.where) ? [a.where] : []),
						],
					};
					if (
						(operation === "updateMany" ||
							operation === "updateManyAndReturn") &&
						"data" in a
					)
						a.data = scopeUpdateData(model, a.data, org);
					return query(a as typeof args);
				}

				if (UNIQUE_WHERE.has(operation)) {
					a.where = compoundWhere(model, isObject(a.where) ? a.where : {}, org);
					if (operation === "update")
						a.data = scopeUpdateData(model, a.data, org);
					if (operation === "upsert") {
						a.create = scopeCreate(model, a.create, org);
						a.update = scopeUpdateData(model, a.update, org);
					}
					return query(a as typeof args);
				}

				if (operation === "create") {
					a.data = scopeCreate(model, a.data, org);
					return query(a as typeof args);
				}
				if (operation === "createMany" || operation === "createManyAndReturn") {
					a.data = scopeCreate(model, a.data, org);
					return query(a as typeof args);
				}

				// Unknown/new operation: be conservative — still require context but pass through.
				return query(a as typeof args);
			},
		},
	},
});

import { Prisma } from "./generated/prisma/client";
import {
	isTenantBypassed,
	TenantContextMissing,
	tenantIdOrNull,
} from "./tenant";
import {
	MODEL_RELATIONS,
	TENANT_COMPOUND_UNIQUES,
	TENANT_FK_SCALARS,
	TENANT_MODELS,
	TENANT_RELATIONS,
	type TenantModel,
} from "./tenant-map.generated";

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

/**
 * Inject the tenant into a create payload and recurse into nested relation writes.
 * Prisma accepts either the *checked* shape (relation objects, e.g. `company: { create }`)
 * or the *unchecked* shape (FK scalars, e.g. `companyId`) — never a mix. A payload with
 * an FK scalar gets `organizationId`; anything else gets `organization: { connect }`,
 * which is valid in the checked shape and in an all-scalar payload alike.
 * `createMany` is always unchecked (`scalarsOnly`).
 */
function scopeCreate(
	model: TenantModel,
	data: unknown,
	org: string,
	scalarsOnly = false,
): unknown {
	if (Array.isArray(data))
		return data.map((d) => scopeCreate(model, d, org, scalarsOnly));
	if (!isObject(data)) return data;
	const out: AnyRecord = { ...data };
	delete out.organizationId;
	delete out.organization;
	const unchecked =
		scalarsOnly || TENANT_FK_SCALARS[model].some((f) => f in out);
	if (unchecked) out.organizationId = org;
	else out.organization = { connect: { id: org } };
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
	// A row can never be re-homed: drop any attempt to change its organization.
	delete out.organizationId;
	delete out.organization;
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
				data: scopeCreate(target, next.createMany.data, org, true),
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
			const one = (u: unknown) => {
				if (!isObject(u)) return u;
				const scoped: AnyRecord = {
					...u,
					create: scopeCreate(target, u.create, org),
					update: scopeUpdateData(target, u.update, org),
				};
				if (isObject(u.where))
					scoped.where = compoundWhere(target, u.where, org);
				return scoped;
			};
			next.upsert = Array.isArray(up) ? up.map(one) : one(up);
		}
		if ("update" in next) {
			const up = next.update;
			const one = (u: unknown) => {
				if (!isObject(u) || !("where" in u || "data" in u))
					return scopeUpdateData(target, u, org);
				const scoped: AnyRecord = {
					...u,
					data: scopeUpdateData(target, u.data, org),
				};
				if (isObject(u.where))
					scoped.where = compoundWhere(target, u.where, org);
				return scoped;
			};
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
 * Walk an `include` / `select` tree and pin every list relation that points at a
 * tenant model with `where: { organizationId }` — this is what stops a read from
 * pulling tenant rows across the boundary. The walk descends through EVERY
 * relation field (to-one and list, global or tenant target) at any depth, so a
 * path through a global model (Contact.owner→User→ownedContacts,
 * Member.user→User→slackMemberMatch, …) is scoped like a direct one. To-one
 * relations need no where-clause of their own: tenant→tenant FKs are pinned by
 * the same-org triggers + compoundWhere, and a to-one to a global model carries
 * no tenant rows itself. Cost is O(selection size): the relation graph is
 * precomputed at generate time (MODEL_RELATIONS), never scanned per query.
 */
function scopeSelection(
	model: string,
	selection: unknown,
	org: string,
): unknown {
	if (!isObject(selection)) return selection;
	const relations = MODEL_RELATIONS[model] ?? {};
	const out: AnyRecord = { ...selection };
	// `_count: { select: { <listRelation>: true | { where } } }` counts like the list does
	if (isObject(out._count) && isObject(out._count.select)) {
		const countSelect: AnyRecord = { ...out._count.select };
		for (const [field, value] of Object.entries(countSelect)) {
			const rel = relations[field];
			if (!rel?.isList || !TENANT.has(rel.target)) continue;
			if (value === false || value === undefined) continue;
			const args: AnyRecord = isObject(value) ? { ...value } : {};
			args.where = {
				AND: [
					{ organizationId: org },
					...(isObject(args.where) ? [args.where] : []),
				],
			};
			countSelect[field] = args;
		}
		out._count = { ...out._count, select: countSelect };
	}
	for (const [field, value] of Object.entries(out)) {
		if (field === "_count") continue;
		const rel = relations[field];
		if (!rel || value === false || value === undefined) continue;
		const scopedList = rel.isList && TENANT.has(rel.target);
		// `field: true` with nothing to pin needs no rewrite — and there is no
		// nested selection to descend into.
		if (!isObject(value) && !scopedList) continue;
		const args: AnyRecord = isObject(value) ? { ...value } : {};
		if (scopedList)
			args.where = {
				AND: [
					{ organizationId: org },
					...(isObject(args.where) ? [args.where] : []),
				],
			};
		if ("include" in args)
			args.include = scopeSelection(rel.target, args.include, org);
		if ("select" in args)
			args.select = scopeSelection(rel.target, args.select, org);
		out[field] = args;
	}
	return out;
}

function scopeSelections(model: string, a: AnyRecord, org: string): void {
	if ("include" in a) a.include = scopeSelection(model, a.include, org);
	if ("select" in a) a.select = scopeSelection(model, a.select, org);
}

/**
 * Fail closed: a global-root query executed with NO tenant context (and not in
 * withoutTenant) must not reach tenant rows through its selection tree. Walks
 * the actual include/select (O(selection size)) and throws the moment any
 * relation path lands on a tenant model. Selections that stay on global models
 * (Session→User, Member→Organization, …) pass — auth depends on that.
 */
function assertSelectionStaysGlobal(
	model: string,
	selection: unknown,
	rootModel: string,
	operation: string,
): void {
	if (!isObject(selection)) return;
	const relations = MODEL_RELATIONS[model] ?? {};
	if (isObject(selection._count) && isObject(selection._count.select)) {
		for (const [field, value] of Object.entries(selection._count.select)) {
			if (value === false || value === undefined) continue;
			const rel = relations[field];
			if (rel && TENANT.has(rel.target))
				throw new TenantContextMissing(rootModel, operation);
		}
	}
	for (const [field, value] of Object.entries(selection)) {
		if (field === "_count" || value === false || value === undefined) continue;
		const rel = relations[field];
		if (!rel) continue;
		if (TENANT.has(rel.target))
			throw new TenantContextMissing(rootModel, operation);
		if (!isObject(value)) continue;
		if ("include" in value)
			assertSelectionStaysGlobal(
				rel.target,
				value.include,
				rootModel,
				operation,
			);
		if ("select" in value)
			assertSelectionStaysGlobal(
				rel.target,
				value.select,
				rootModel,
				operation,
			);
	}
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
					// Global model: its selection tree may still reach tenant rows.
					// With a tenant set, every such path is scoped; with none, a
					// selection that reaches a tenant model throws (fail closed).
					// Selection-free queries pass through — auth depends on that.
					if (isObject(args) && ("include" in args || "select" in args)) {
						const a: AnyRecord = { ...args };
						if (org) {
							scopeSelections(model, a, org);
							return query(a as typeof args);
						}
						assertSelectionStaysGlobal(model, a.include, model, operation);
						assertSelectionStaysGlobal(model, a.select, model, operation);
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
					a.data = scopeCreate(model, a.data, org, true);
					return query(a as typeof args);
				}

				// Unknown/new operation: be conservative — still require context but pass through.
				return query(a as typeof args);
			},
		},
	},
});

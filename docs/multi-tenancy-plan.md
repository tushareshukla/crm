# Multi-tenancy + RBAC — implementation plan (fork: tusharrXop/crm, branch `multi-tenant`)

Status: Phase 1 in progress. Decisions were taken with the owner on 2026-08-19 (see §0).

## 0. Decisions (fixed)
- Invite-only tenants. Platform admins (`PLATFORM_ADMINS` env, comma-separated emails) create orgs and invite the first owner via `/admin`. Orgs invite members themselves. Invites are **copy-link** tokens (no email).
- A user may belong to many orgs. **URL slug decides the active org** (`/[slug]/…`); sidebar switcher; last-used org after sign-in.
- Platform admin may **enter any org** (support mode). Every entry is written to the org's audit log.
- Keys: platform default (env) with **per-org override** in Settings → General for Context.dev, Perplexity, agent model. AI Gateway key is platform-only.
- Mailbox / Calendar / Slack connections are **per (user, org)**; synced data lands only in that org.
- Tracking & forms: shared domain, **per-org site-id**; `/t/[site]` resolves the org from the site-id.
- Research agent: **per-org queue + per-org daily task cap**, platform-paid.
- Isolation: **app-level** — Prisma client extension injects `organizationId` on every read/write of tenant models from an AsyncLocalStorage tenant context; **no context ⇒ throw** (fail closed) unless explicitly `withoutTenant()`; `organizationId NOT NULL` on every tenant table; cross-tenant tests. No RLS.
- Existing single-workspace data is **discarded** (fresh DB).
- RBAC v1 = custom roles × permission matrix, record ownership/visibility, teams/hierarchy, field-level permissions — shipped incrementally (phases 2–4).
- Org: name, slug (owner-editable), logo; suspend/delete; seat/record/agent caps; per-org audit log.
- Rollout: replace `crm.prakriya.work` per phase. First org: **Shopify ABM** (`shopify-abm`).

## 1. Architecture
### 1.1 Tenant context (`packages/db/src/tenant.ts`)
```ts
runWithTenant(orgId, fn)      // AsyncLocalStorage
currentTenantId(): string      // throws TenantContextMissing
withoutTenant(fn)              // explicit bypass for system paths (dispatch loops, cron, auth)
```
### 1.2 Prisma extension (`packages/db/src/tenant-extension.ts`)
`db = base.$extends(tenantScoping)`; for every operation on a **tenant model** (list derived from DMMF: models having an `organizationId` field):
- reads (`findMany/First/Unique/UniqueOrThrow/count/aggregate/groupBy/exists`): `where = { AND: [{ organizationId }, where] }`; `findUnique*` → rewritten to `findFirst*` (unique keys became compound with org).
- writes: `create/createMany/upsert` → inject `organizationId` into `data`/`create` (+ nested `create/createMany/connectOrCreate.create` for relation fields that target tenant models, walked via DMMF); `update/updateMany/delete/deleteMany` → inject into `where`.
- `$transaction(tx => …)` inherits the same ALS store.
- No context: throw `TenantContextMissing` (except inside `withoutTenant`).
### 1.3 Schema (Prisma, fresh migration `20260819_multi_tenant`)
- Add `organizationId String` + `organization Organization @relation(onDelete: Cascade)` + `@@index([organizationId])` to all tenant models (§3). Compound uniques: `Company(organizationId, domain)`, `Contact(organizationId, email)`, `FieldDefinition(organizationId, entity, key)`, `TrackedDomain(organizationId, host)`, `MailboxSync(organizationId, userId, source)`, `EmailThread(organizationId, rootMessageId)`, `EmailMessage(organizationId, rfcMessageId)`, `CalendarEvent(organizationId, iCalUid, originalStartTime)`, `SlackMemberMatch(organizationId, crmUserId)`, `SsoProvider(organizationId, providerId)`, `AppSetting.id → organizationId` (1:1), `WorkspaceProfile.id → organizationId`.
- `Organization`: + `logoUrl`, `status ENUM(active,suspended)`, `limits Json` (maxMembers, maxContacts, agentTasksPerDay), `settings Json` (key overrides), `lastUsed` per member (`Member.lastActiveAt`).
- New: `OrgInvite(id, organizationId, email?, roleId, tokenHash, expiresAt, createdById, acceptedAt)`; `AuditEvent(id, organizationId, actorId, type, subject, data, at)`; RBAC tables in phase 2 (`Role`, `RolePermission`, `Team`, `TeamMember`, `FieldPolicy`); `Deal.ownerId`, `Contact.ownerId`, `Company.ownerId` (phase 3).
- Global (no org): `User, Session, Account, Verification, RateLimit, Organization, Member, Invitation(better-auth), ExchangeRate, Install, Telemetry*`.
### 1.4 Entry points
- **API (NestJS/tRPC)**: `TenantMiddleware` after `AuthMiddleware`: resolve org = header `x-org-slug` (sent by app) → must be member (or platform admin in support mode) → `runWithTenant`. Express REST routes (`/internal/*`, `/api/conversations/attachments`, tracking) get explicit resolution. `workspace.get` → `org.get(slug)`; new `orgs.*`, `admin.*`, `invites.*`, `audit.*` routers.
- **App (Next)**: `[slug]` layout resolves org via API; tRPC links add `x-org-slug` from the path; sign-in → `/` → redirect to last-used org or `/welcome` (no org) or `/admin`.
- **Agent (eve)**: dispatch loop lists due tasks `withoutTenant` (select id, organizationId, cap counters) → each run wrapped in `runWithTenant(task.organizationId)`; per-org daily cap enforced at enqueue + dispatch; Context/Perplexity key resolution = org override ?? platform env.
- **Cron** (`/internal/sync/mailboxes`, retention): iterate orgs `withoutTenant`, run each `runWithTenant`.
- **Tracking collector** (`/t/[site]`, `/t/crm.js`): siteId → org (lookup `withoutTenant` on `AppSetting.trackingSiteId`) → `runWithTenant`.
- **Auth hooks**: user.create: allow if (a) platform admin email, or (b) valid invite token in sign-up flow; session.create: `activeOrganizationId` = last used membership.

## 2. Phases
- **P1 Tenancy core** — schema, tenant ctx + extension, API tenant middleware, org routers, invites (copy-link), `/admin` console (orgs CRUD, caps, suspend, invite owner, enter-org), org switcher + `[slug]` wiring, agent/cron/tracking scoping, audit log (basic), tests (isolation + invites + admin), deploy.
- **P2 Custom roles** — `Role`/`RolePermission` per org, permission matrix UI, `can(resource, action)` middleware on all mutations/queries, default roles seeded (Owner/Admin/Member), migrate better-auth roles to it.
- **P3 Ownership & teams** — `ownerId` on Deal/Contact/Company, visibility scopes (own / team / all) baked into tenant extension as an extra where-clause, `Team`/`TeamMember`/manager, list filters.
- **P4 Field-level** — `FieldPolicy(roleId, entity, field, mode: hidden|readonly)`, API response masking + input rejection, UI lock/hide.

## 3. Tenant models
Company, CompanyEnrichment, Contact, ContactFact, ContactBrief, AgentTask, AgentEvent, AgentConversation, AgentConversationFeedback, AgentConversationShare, AgentConversationSubmission, AgentConversationAttachment, AgentDefinition, AgentVersion, AgentBuilderArtifact, AgentTrigger, AgentRun, AgentRunEvent, AgentAction, AgentAuditEvent, Deal, DealContact, FieldDefinition, FieldOption, FieldValue, Activity, MailboxSync, EmailThread, EmailMessage, CalendarEvent, CalendarAttendee, SuppressedDomain, SuppressedContact, AppSetting, WorkspaceProfile, TrackedDomain, TrackedVisitor, TrackedEvent, TrackingCounter, TrackedPageDaily, FormSubmission, SlackInstallation, SlackChannel, SlackMemberMatch, SlackWorkspaceGrant, SsoProvider, OrgInvite, AuditEvent.

## 4. Verification
- `bun run check-types`, `bun run lint`, `bun run test` (integration, TEST_DATABASE_URL) green.
- New tests: (a) extension injects org on every op incl. nested creates; (b) query without context throws; (c) two orgs, same email contact, no cross-read; (d) invite accept flow; (e) admin enter-org writes audit; (f) agent dispatch respects cap + context.
- Smoke on prod after deploy: admin creates `shopify-abm`, invites owner link, accept, create contact, second org can't see it.

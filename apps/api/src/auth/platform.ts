/**
 * Platform-level organization helpers (platform admins, memberships).
 *
 * They live in `packages/auth/src/organization.ts`, which `@crm/auth` does not
 * publish as a subpath yet (`@crm/auth/organization` is not in its `exports`).
 * Until it does, this is the single place the API reaches into that file, so
 * switching to the package export is a one-line change here.
 */
export {
	isPlatformAdmin,
	listUserOrganizations,
	touchMembership,
	type UserOrganization,
} from "@crm/auth/organization";

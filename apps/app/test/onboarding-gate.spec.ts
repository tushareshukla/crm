import { afterEach, describe, expect, it } from "bun:test";
import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import { NextRequest } from "next/server";
import {
	readHome,
	readResearchGate,
	readWorkspaceGate,
} from "../lib/onboarding";
import { ORG_SLUG_HEADER } from "../lib/org-slug";
import { proxy } from "../proxy";

const SESSION_COOKIE = `${AUTH_COOKIE_PREFIX}.session_token=abc.def`;

const SLUG = "comp-ai";

const realFetch = globalThis.fetch;

const realMarketing = process.env.IS_MARKETING;

afterEach(() => {
	globalThis.fetch = realFetch;
	marketing(realMarketing);
});

function marketing(value: string | undefined) {
	if (value === undefined) delete process.env.IS_MARKETING;
	else process.env.IS_MARKETING = value;
}

type Stub = (url: string, init?: RequestInit) => Promise<Response>;

function stub(handler: Stub) {
	globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
		handler(String(input), init)) as unknown as typeof fetch;
}

type GateResponse =
	| { result: { data: unknown } }
	| { error: { message: string } };

function json(body: GateResponse, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function answerWith(body: GateResponse, status = 200) {
	stub(async () => json(body, status));
}

const workspace = (data: {
	onboarded: boolean;
	canRename: boolean;
	slug?: string;
	supportMode?: boolean;
}) => ({ result: { data: { slug: SLUG, ...data } } });

const researchKey = (configured: boolean) => ({
	result: { data: { configured, hint: configured ? "••••9876" : null } },
});

type Org = { slug: string; status?: "ACTIVE" | "SUSPENDED" };

/** Answers every procedure the proxy asks, counting the calls to each and remembering the org header sent. */
function setup({
	onboarded = true,
	canRename = true,
	configured = true,
	supportMode = false,
	slug = SLUG,
	orgs = [{ slug: SLUG }] as Org[],
	platformAdmin = false,
}: {
	onboarded?: boolean;
	canRename?: boolean;
	configured?: boolean;
	supportMode?: boolean;
	slug?: string;
	orgs?: Org[];
	platformAdmin?: boolean;
} = {}) {
	const calls = { workspace: 0, research: 0, mine: 0, me: 0 };
	const orgHeaders: (string | null)[] = [];

	stub(async (url, init) => {
		const headers = new Headers(init?.headers);
		orgHeaders.push(headers.get(ORG_SLUG_HEADER));

		if (url.includes("workspace.get")) {
			calls.workspace += 1;
			return json(workspace({ onboarded, canRename, slug, supportMode }));
		}

		if (url.includes("orgs.mine")) {
			calls.mine += 1;
			return json({
				result: {
					data: orgs.map((org) => ({
						id: `org_${org.slug}`,
						name: org.slug,
						slug: org.slug,
						logo: null,
						role: "member",
						status: org.status ?? "ACTIVE",
						lastActiveAt: null,
					})),
				},
			});
		}

		if (url.includes("users.me")) {
			calls.me += 1;
			return json({ result: { data: { id: "user_1", platformAdmin } } });
		}

		calls.research += 1;
		return json(researchKey(configured));
	});

	return { calls, orgHeaders };
}

function request(pathname: string, cookies: string[] = []) {
	return new NextRequest(new URL(pathname, "http://localhost:3000"), {
		headers: cookies.length ? { cookie: cookies.join("; ") } : {},
	});
}

function redirectedTo(response: Response): string | null {
	const location = response.headers.get("location");

	return location ? new URL(location).pathname : null;
}

function redirectedWithSearch(response: Response): string | null {
	const location = response.headers.get("location");

	if (!location) return null;

	const url = new URL(location);
	return `${url.pathname}${url.search}`;
}

/** The org slug the proxy stamped onto the request for server components. */
function stampedOrgSlug(response: Response): string | null {
	return response.headers.get(`x-middleware-request-${ORG_SLUG_HEADER}`);
}

async function gateOf(pathname: string, slug = SLUG) {
	return (await readWorkspaceGate(request(pathname, [SESSION_COOKIE]), slug))
		.gate;
}

describe("readWorkspaceGate", () => {
	it("reads the answer out of a plain tRPC envelope", async () => {
		answerWith(workspace({ onboarded: false, canRename: true }));

		expect(await gateOf("/")).toBe("required");
	});

	it("settles for someone who could not answer the form anyway", async () => {
		answerWith(workspace({ onboarded: false, canRename: false }));

		expect(await gateOf("/")).toBe("settled");
	});

	it("settles for a platform admin looking in: setup is not theirs to do", async () => {
		answerWith(
			workspace({ onboarded: false, canRename: true, supportMode: true }),
		);

		expect(await gateOf("/")).toBe("settled");
	});

	it("carries the slug and whether this is support mode", async () => {
		answerWith(workspace({ onboarded: true, canRename: true }));

		expect(
			await readWorkspaceGate(request("/", [SESSION_COOKIE]), SLUG),
		).toEqual({
			gate: "settled",
			slug: SLUG,
			supportMode: false,
		});
	});

	it("asks about the organization it is given", async () => {
		const { orgHeaders } = setup();

		await readWorkspaceGate(request("/", [SESSION_COOKIE]), "globex");

		expect(orgHeaders).toEqual(["globex"]);
	});

	it("is unknown rather than required when the API cannot be read", async () => {
		answerWith({ error: { message: "UNAUTHORIZED" } }, 401);
		expect(await gateOf("/")).toBe("unknown");

		stub(async () => {
			throw new Error("connect ECONNREFUSED");
		});
		expect(await gateOf("/")).toBe("unknown");

		answerWith({ result: { data: { nothing: "useful" } } });
		expect(await gateOf("/")).toBe("unknown");
	});
});

describe("readResearchGate", () => {
	it("is settled once a key is saved, and required until then", async () => {
		answerWith(researchKey(true));
		expect(await readResearchGate(request("/", [SESSION_COOKIE]), SLUG)).toBe(
			"settled",
		);

		answerWith(researchKey(false));
		expect(await readResearchGate(request("/", [SESSION_COOKIE]), SLUG)).toBe(
			"required",
		);
	});

	it("is unknown rather than required when the API cannot be read", async () => {
		stub(async () => {
			throw new Error("connect ECONNREFUSED");
		});

		expect(await readResearchGate(request("/", [SESSION_COOKIE]), SLUG)).toBe(
			"unknown",
		);
	});
});

describe("readHome", () => {
	it("reads the rep's organizations and whether they run the platform", async () => {
		setup({ orgs: [{ slug: "globex" }, { slug: SLUG }], platformAdmin: true });

		expect(await readHome(request("/", [SESSION_COOKIE]))).toEqual({
			platformAdmin: true,
			organizations: [
				{ slug: "globex", status: "ACTIVE" },
				{ slug: SLUG, status: "ACTIVE" },
			],
		});
	});

	it("is null when the organizations cannot be read", async () => {
		stub(async () => {
			throw new Error("connect ECONNREFUSED");
		});

		expect(await readHome(request("/", [SESSION_COOKIE]))).toBeNull();
	});

	it("asks nothing without a session cookie", async () => {
		const { calls } = setup();

		expect(await readHome(request("/"))).toBeNull();
		expect(calls.mine).toBe(0);
	});
});

describe("proxy", () => {
	it("shows a stranger the landing page and nothing behind it", async () => {
		marketing("true");

		expect(redirectedTo(await proxy(request("/")))).toBeNull();
		expect(redirectedTo(await proxy(request("/sign-in")))).toBeNull();
		expect(redirectedTo(await proxy(request(`/${SLUG}`)))).toBe("/sign-in");
		expect(redirectedTo(await proxy(request(`/${SLUG}/companies`)))).toBe(
			"/sign-in",
		);
		expect(redirectedTo(await proxy(request("/admin")))).toBe("/sign-in");
	});

	it("sends a stranger to sign in when the install has no landing page", async () => {
		marketing(undefined);

		expect(redirectedTo(await proxy(request("/")))).toBe("/sign-in");
		expect(redirectedTo(await proxy(request("/sign-in")))).toBeNull();
	});

	it("keeps a stranger's invitation link through sign-in", async () => {
		expect(redirectedWithSearch(await proxy(request("/invite/inv_123")))).toBe(
			"/sign-in?next=%2Finvite%2Finv_123",
		);
	});

	it("never aims a redirect at the sign-in page itself", async () => {
		marketing(undefined);
		setup({ onboarded: false, configured: false });

		expect(redirectedTo(await proxy(request("/sign-in")))).toBeNull();
		expect(
			redirectedTo(await proxy(request("/sign-in", [SESSION_COOKIE]))),
		).toBeNull();
		expect(
			redirectedTo(await proxy(request("/sign-in?method=google"))),
		).toBeNull();
	});

	it("reads the flag on every request, and only the literal true turns it on", async () => {
		marketing("false");
		expect(redirectedTo(await proxy(request("/")))).toBe("/sign-in");

		marketing("1");
		expect(redirectedTo(await proxy(request("/")))).toBe("/sign-in");

		marketing("true");
		expect(redirectedTo(await proxy(request("/")))).toBeNull();
	});

	it("ignores a neighbour's cookie from the parent domain", async () => {
		expect(AUTH_COOKIE_PREFIX).not.toBe("better-auth");
		setup();

		expect(
			redirectedTo(
				await proxy(
					request(`/${SLUG}/companies`, [
						"better-auth.session_token=someone.else",
					]),
				),
			),
		).toBe("/sign-in");
	});

	it("gates a signed-in rep who has not answered the form", async () => {
		setup({ onboarded: false });

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/companies`, [SESSION_COOKIE])),
			),
		).toBe(`/${SLUG}/onboarding`);
	});

	it("lets the form itself render", async () => {
		setup({ onboarded: false });

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/onboarding`, [SESSION_COOKIE])),
			),
		).toBeNull();
	});

	it("asks about the organization in the URL, every time, and remembers nothing", async () => {
		const { calls, orgHeaders } = setup();

		const first = await proxy(request(`/${SLUG}/companies`, [SESSION_COOKIE]));

		expect([...first.cookies.getAll()]).toHaveLength(0);
		expect(calls).toEqual({ workspace: 1, research: 1, mine: 0, me: 0 });
		expect(orgHeaders).toEqual([SLUG, SLUG]);

		await proxy(request("/globex/companies", [SESSION_COOKIE]));

		expect(calls).toEqual({ workspace: 2, research: 2, mine: 0, me: 0 });
		expect(orgHeaders.slice(2)).toEqual(["globex", "globex"]);
	});

	it("stamps the organization onto the request for server components", async () => {
		setup();

		const response = await proxy(
			request(`/${SLUG}/settings/sso`, [SESSION_COOKIE]),
		);

		expect(redirectedTo(response)).toBeNull();
		expect(stampedOrgSlug(response)).toBe(SLUG);
	});

	it("stamps the slug from the URL, not what the browser sent", async () => {
		setup();

		const forged = new NextRequest(
			new URL(`/${SLUG}/companies`, "http://localhost:3000"),
			{ headers: { cookie: SESSION_COOKIE, [ORG_SLUG_HEADER]: "globex" } },
		);

		expect(stampedOrgSlug(await proxy(forged))).toBe(SLUG);
	});

	it("drops a browser-sent organization header on pages that belong to none", async () => {
		setup();

		for (const pathname of ["/admin", "/welcome", "/invite/inv_1"]) {
			const forged = new NextRequest(
				new URL(pathname, "http://localhost:3000"),
				{ headers: { cookie: SESSION_COOKIE, [ORG_SLUG_HEADER]: "globex" } },
			);
			const response = await proxy(forged);

			expect(stampedOrgSlug(response)).toBeNull();
			expect(
				response.headers.get("x-middleware-override-headers")?.split(","),
			).not.toContain(ORG_SLUG_HEADER);
		}
	});

	it("notices when the answer changes underneath it", async () => {
		setup();
		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/companies`, [SESSION_COOKIE])),
			),
		).toBeNull();

		// A reset database, a removed key: the browser is carrying nothing that
		// could keep saying the gate was satisfied.
		setup({ onboarded: false });
		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/companies`, [SESSION_COOKIE])),
			),
		).toBe(`/${SLUG}/onboarding`);
	});

	it("takes a settled rep off both setup pages and into the workspace", async () => {
		setup();

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/onboarding`, [SESSION_COOKIE])),
			),
		).toBe(`/${SLUG}`);

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/onboarding/research`, [SESSION_COOKIE])),
			),
		).toBe(`/${SLUG}`);
	});

	it("never asks a platform admin looking in to set the organization up", async () => {
		setup({ onboarded: false, configured: false, supportMode: true });

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/companies`, [SESSION_COOKIE])),
			),
		).toBeNull();

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/onboarding`, [SESSION_COOKIE])),
			),
		).toBe(`/${SLUG}`);
	});

	it("never fights /grant-access, which would ping-pong forever", async () => {
		setup({ onboarded: false });

		expect(
			redirectedTo(await proxy(request("/grant-access", [SESSION_COOKIE]))),
		).toBeNull();
	});

	it("leaves the pages that belong to no organization alone", async () => {
		const { calls } = setup({ onboarded: false });

		for (const pathname of ["/admin", "/welcome", "/invite/inv_123"]) {
			const response = await proxy(request(pathname, [SESSION_COOKIE]));

			expect(redirectedTo(response)).toBeNull();
			expect(stampedOrgSlug(response)).toBeNull();
		}

		expect(calls).toEqual({ workspace: 0, research: 0, mine: 0, me: 0 });
	});

	it("leaves the agent bridge alone", async () => {
		setup({ onboarded: false });

		expect(
			redirectedTo(await proxy(request("/eve/v1/info", [SESSION_COOKIE]))),
		).toBeNull();
	});

	it("fails open when the API is unreachable", async () => {
		stub(async () => {
			throw new Error("connect ECONNREFUSED");
		});

		const response = await proxy(
			request(`/${SLUG}/companies`, [SESSION_COOKIE]),
		);

		expect(redirectedTo(response)).toBeNull();
		expect(stampedOrgSlug(response)).toBe(SLUG);
	});

	it("lets an address that is not theirs through to the page, which says not found", async () => {
		answerWith({ error: { message: "not-a-member" } }, 403);

		expect(
			redirectedTo(
				await proxy(request("/old-name/settings/members", [SESSION_COOKIE])),
			),
		).toBeNull();
	});
});

describe("the landing page after sign-in", () => {
	it("sends a signed-in rep into their last-used organization", async () => {
		setup({ orgs: [{ slug: "globex" }, { slug: SLUG }] });

		expect(redirectedTo(await proxy(request("/", [SESSION_COOKIE])))).toBe(
			"/globex",
		);
	});

	it("skips a suspended organization when there is an open one", async () => {
		setup({ orgs: [{ slug: "globex", status: "SUSPENDED" }, { slug: SLUG }] });

		expect(redirectedTo(await proxy(request("/", [SESSION_COOKIE])))).toBe(
			`/${SLUG}`,
		);
	});

	it("sends a platform admin with no organization to the console", async () => {
		setup({ orgs: [], platformAdmin: true });

		expect(redirectedTo(await proxy(request("/", [SESSION_COOKIE])))).toBe(
			"/admin",
		);
	});

	it("sends a platform admin with an organization into it, not the console", async () => {
		setup({ orgs: [{ slug: SLUG }], platformAdmin: true });

		expect(redirectedTo(await proxy(request("/", [SESSION_COOKIE])))).toBe(
			`/${SLUG}`,
		);
	});

	it("welcomes a rep who belongs nowhere yet", async () => {
		setup({ orgs: [] });

		expect(redirectedTo(await proxy(request("/", [SESSION_COOKIE])))).toBe(
			"/welcome",
		);
	});

	it("shows the suspended page rather than welcome when that is all they have", async () => {
		setup({ orgs: [{ slug: SLUG, status: "SUSPENDED" }] });

		expect(redirectedTo(await proxy(request("/", [SESSION_COOKIE])))).toBe(
			`/${SLUG}`,
		);
	});

	it("puts the slug on a link that predates it, keeping the query", async () => {
		setup();

		const response = await proxy(
			request("/companies?record=contact:abc", [SESSION_COOKIE]),
		);

		expect(response.headers.get("location")).toBe(
			`http://localhost:3000/${SLUG}/companies?record=contact:abc`,
		);
	});

	it("leaves a request that already carries the slug alone", async () => {
		setup();

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/settings/sso`, [SESSION_COOKIE])),
			),
		).toBeNull();
	});

	it("rewrites nothing when the rep belongs nowhere", async () => {
		setup({ orgs: [] });

		expect(
			redirectedTo(await proxy(request("/companies", [SESSION_COOKIE]))),
		).toBeNull();
	});

	it("fails open when the organizations cannot be read", async () => {
		stub(async () => {
			throw new Error("connect ECONNREFUSED");
		});

		expect(
			redirectedTo(await proxy(request("/", [SESSION_COOKIE]))),
		).toBeNull();
	});
});

describe("the research key gate", () => {
	it("sends an onboarded rep with no key to the key form", async () => {
		setup({ configured: false });

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/companies`, [SESSION_COOKIE])),
			),
		).toBe(`/${SLUG}/onboarding/research`);
	});

	it("lets that form render rather than looping onto itself", async () => {
		setup({ configured: false });

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/onboarding/research`, [SESSION_COOKIE])),
			),
		).toBeNull();
	});

	it("asks the first question first when both are outstanding", async () => {
		setup({ onboarded: false, configured: false });

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/companies`, [SESSION_COOKIE])),
			),
		).toBe(`/${SLUG}/onboarding`);
	});

	it("sends them on to the key once the workspace is named", async () => {
		setup({ onboarded: true, configured: false });

		expect(
			redirectedTo(
				await proxy(request(`/${SLUG}/onboarding`, [SESSION_COOKIE])),
			),
		).toBe(`/${SLUG}/onboarding/research`);
	});
});

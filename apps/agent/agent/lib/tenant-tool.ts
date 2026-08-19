import { defineTool as defineEveTool, type ToolContext } from "eve/tools";
import { inSessionTenant } from "./tenant";

type AnyToolDefinition = {
	execute: (input: unknown, ctx: ToolContext) => unknown;
	approval?: unknown;
	toModelOutput?: unknown;
};

/**
 * The same as eve's defineTool, except the tool runs inside the organization
 * its session belongs to. Every tool under agent/tools and
 * agent/subagents/(star)/tools imports this rather than eve/tools, so no tool
 * can touch a tenant model outside the session's organization, and a session
 * that names none fails closed on its first query.
 */
export const defineTool: typeof defineEveTool = ((
	definition: AnyToolDefinition,
) =>
	defineEveTool({
		...definition,
		execute: (input: unknown, ctx: ToolContext) =>
			inSessionTenant(ctx, () => definition.execute(input, ctx)),
	} as never)) as typeof defineEveTool;

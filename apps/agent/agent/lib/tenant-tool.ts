import {
	defineTool as defineEveTool,
	type ToolContext,
	type ToolDefinition,
} from "eve/tools";
import { inSessionTenant } from "./tenant";

/**
 * The same as eve's defineTool, except the tool runs inside the organization
 * its session belongs to. Every tool under agent/tools and
 * agent/subagents/(star)/tools imports this rather than eve/tools, so no tool
 * can touch a tenant model outside the session's organization, and a session
 * that names none fails closed on its first query.
 */
export const defineTool: typeof defineEveTool = (<TInput, TOutput>(
	definition: ToolDefinition<TInput, TOutput>,
) =>
	defineEveTool({
		...definition,
		execute: (input: TInput, ctx: ToolContext) =>
			inSessionTenant(ctx, () => definition.execute(input, ctx)),
	} as never)) as typeof defineEveTool;

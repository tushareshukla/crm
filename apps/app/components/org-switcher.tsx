"use client";

import Checkmark from "@carbon/icons-react/es/Checkmark";
import ChevronDown from "@carbon/icons-react/es/ChevronDown";
import Settings from "@carbon/icons-react/es/Settings";
import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { Icon } from "@crm/ui/components/icon";
import { cn } from "@crm/ui/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ADMIN_PATH } from "@/lib/home";
import { useTRPC } from "@/lib/trpc/client";
import { workspaceLabel } from "@/lib/workspace-label";
import { workspaceUrl } from "@/lib/workspace-url";

export type CurrentOrganization = {
	id: string;
	name: string;
	slug: string;
	/** A platform admin looking in without being a member. */
	supportMode: boolean;
};

/**
 * The organization the rep is in, and the way to every other one they belong
 * to. Each entry links to `/<slug>`: the URL is what decides the active
 * organization, so switching is a navigation — `switchTo` only remembers the
 * choice for the next sign-in.
 */
export function OrgSwitcher({
	organization,
}: {
	organization: CurrentOrganization;
}) {
	const trpc = useTRPC();
	const router = useRouter();

	const mine = useQuery(trpc.orgs.mine.queryOptions());
	const me = useQuery(trpc.users.me.queryOptions());
	const remember = useMutation(trpc.orgs.switchTo.mutationOptions());

	const label = workspaceLabel(organization.name);
	const others = (mine.data ?? []).filter(
		(org) => org.slug !== organization.slug,
	);
	const platformAdmin = me.data?.platformAdmin ?? false;

	return (
		<div className="flex min-w-0 items-center gap-1.5">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						className="min-w-0 max-w-56 gap-1 px-1.5 font-medium text-sm hover:bg-muted"
						aria-label={`Switch organization (currently ${label})`}
					>
						<span className="min-w-0 truncate">{label}</span>
						<Icon
							icon={ChevronDown}
							className="shrink-0 text-muted-foreground"
						/>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="min-w-60">
					<DropdownMenuLabel className="text-muted-foreground text-xs">
						Organizations
					</DropdownMenuLabel>
					<DropdownMenuItem asChild data-checked>
						<Link href={workspaceUrl(organization.slug)}>
							<Icon icon={Checkmark} />
							<span className="min-w-0 truncate">{label}</span>
							<span className="ml-auto text-muted-foreground text-xs">
								/{organization.slug}
							</span>
						</Link>
					</DropdownMenuItem>
					{others.map((org) => (
						<DropdownMenuItem
							key={org.id}
							onSelect={() => {
								remember.mutate({ slug: org.slug });
								router.push(workspaceUrl(org.slug));
							}}
							className={cn(
								org.status === "SUSPENDED" && "text-muted-foreground",
							)}
						>
							<span className="size-4 shrink-0" aria-hidden />
							<span className="min-w-0 truncate">
								{workspaceLabel(org.name)}
							</span>
							<span className="ml-auto text-muted-foreground text-xs">
								{org.status === "SUSPENDED" ? "Suspended" : `/${org.slug}`}
							</span>
						</DropdownMenuItem>
					))}
					{mine.isPending && others.length === 0 ? (
						<DropdownMenuItem disabled>Loading…</DropdownMenuItem>
					) : null}
					{platformAdmin ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem asChild>
								<Link href={ADMIN_PATH}>
									<Icon icon={Settings} />
									Platform console
								</Link>
							</DropdownMenuItem>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>

			{organization.supportMode ? (
				<Badge
					variant="outline"
					className="shrink-0 border-amber-500/50 text-amber-700 dark:text-amber-400"
					title="You are not a member of this organization. Every visit is written to its audit log."
				>
					Support mode
				</Badge>
			) : null}
		</div>
	);
}

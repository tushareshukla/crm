"use client";

import { Button } from "@crm/ui/components/button";
import { PersonAvatar } from "@crm/ui/components/person-avatar";
import { Spinner } from "@crm/ui/components/spinner";
import { LocalRelativeTime } from "@/components/local-date-time";
import {
	auditActorLabel,
	auditEventDetail,
	auditEventLabel,
} from "@/lib/audit-event";

export type AuditEventItem = {
	id: string;
	type: string;
	subject: string | null;
	data: unknown;
	createdAt: string;
	actor: {
		id: string;
		name: string;
		email: string;
		image: string | null;
	} | null;
};

/** A page of an audit log, newest first, with a way to ask for the page after it. */
export function AuditEventList({
	events,
	loading,
	hasMore,
	onMore,
	empty = "Nothing has happened here yet.",
}: {
	events: readonly AuditEventItem[];
	loading: boolean;
	hasMore: boolean;
	onMore: () => void;
	empty?: string;
}) {
	if (events.length === 0) {
		return (
			<p
				className="text-muted-foreground text-sm"
				role={loading ? "status" : undefined}
			>
				{loading ? "Loading…" : empty}
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<ol className="flex flex-col divide-y">
				{events.map((event) => {
					const detail = auditEventDetail(event);

					return (
						<li key={event.id} className="flex items-start gap-3 py-2.5">
							<PersonAvatar
								size="sm"
								src={event.actor?.image ?? null}
								name={auditActorLabel(event.actor)}
								email={event.actor?.email ?? ""}
							/>
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								<p className="text-sm">
									<span className="font-medium">
										{auditActorLabel(event.actor)}
									</span>{" "}
									<span className="text-muted-foreground">·</span>{" "}
									{auditEventLabel(event.type)}
								</p>
								{detail ? (
									<p className="truncate text-muted-foreground text-xs">
										{detail}
									</p>
								) : null}
							</div>
							<span className="shrink-0 text-muted-foreground text-xs">
								<LocalRelativeTime date={event.createdAt} />
							</span>
						</li>
					);
				})}
			</ol>

			{hasMore ? (
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="self-start"
					disabled={loading}
					onClick={onMore}
				>
					{loading ? <Spinner data-icon="inline-start" /> : null}
					Load more
				</Button>
			) : null}
		</div>
	);
}

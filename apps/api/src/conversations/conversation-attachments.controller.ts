import type { auth } from "@crm/auth";
import { type Db, runWithTenant, withoutTenant } from "@crm/db";
import {
	Controller,
	Get,
	NotFoundException,
	Param,
	Query,
	Res,
	StreamableFile,
} from "@nestjs/common";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import type { Response } from "express";
import { InjectDatabase } from "../database/database.constants";
import { ConversationsService } from "./conversations.service";

type CrmSession = UserSession<typeof auth>;

@Controller("api/conversations/attachments")
export class ConversationAttachmentsController {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly conversations: ConversationsService,
	) {}

	/**
	 * Plain `<img>` / link fetches carry no `x-org-slug`, so the attachment id
	 * names the organization: a platform-level lookup of its organization only,
	 * after which the service enforces membership and ownership inside that
	 * organization's scope.
	 */
	@Get(":id")
	async read(
		@Param("id") id: string,
		@Query("share") shareToken: string | undefined,
		@Session() session: CrmSession,
		@Res({ passthrough: true }) response: Response,
	) {
		const owner = await withoutTenant(() =>
			this.db.agentConversationAttachment.findUnique({
				where: { id },
				select: { organizationId: true },
			}),
		);

		if (!owner) {
			throw new NotFoundException("That attachment is unavailable.");
		}

		const attachment = await runWithTenant(owner.organizationId, () =>
			this.conversations.attachment(id, session.user.id, shareToken),
		);
		const content = Buffer.from(attachment.content);
		const disposition = attachment.previewable ? "inline" : "attachment";
		const mediaType = attachment.previewable
			? attachment.mediaType
			: "application/octet-stream";

		response.setHeader("Cache-Control", "private, no-store");
		response.setHeader("Content-Length", content.byteLength.toString());
		response.setHeader("Content-Type", mediaType);
		response.setHeader(
			"Content-Disposition",
			`${disposition}; filename*=UTF-8''${encodeHeaderValue(attachment.name)}`,
		);
		response.setHeader("X-Content-Type-Options", "nosniff");

		return new StreamableFile(content);
	}
}

function encodeHeaderValue(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

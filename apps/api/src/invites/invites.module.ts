import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { InvitesRouter } from "./invites.router";
import { InvitesService } from "./invites.service";

@Module({
	imports: [TrpcModule],
	providers: [InvitesService, InvitesRouter],
	exports: [InvitesService],
})
export class InvitesModule {}

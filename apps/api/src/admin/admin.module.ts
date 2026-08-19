import { Module } from "@nestjs/common";
import { InvitesModule } from "../invites/invites.module";
import { TrpcModule } from "../trpc/trpc.module";
import { AdminRouter } from "./admin.router";
import { AdminService } from "./admin.service";

@Module({
	imports: [TrpcModule, InvitesModule],
	providers: [AdminService, AdminRouter],
})
export class AdminModule {}

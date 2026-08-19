import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { OrgsRouter } from "./orgs.router";
import { OrgsService } from "./orgs.service";

@Module({
	imports: [TrpcModule],
	providers: [OrgsService, OrgsRouter],
	exports: [OrgsService],
})
export class OrgsModule {}

import { Global, Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { AuditRouter } from "./audit.router";
import { AuditService } from "./audit.service";

/** Global so the tenant middleware (in TrpcModule) can write admin entries without a module cycle. */
@Global()
@Module({
	imports: [TrpcModule],
	providers: [AuditService, AuditRouter],
	exports: [AuditService],
})
export class AuditModule {}

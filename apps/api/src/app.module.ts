import { auth } from "@crm/auth";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule as BetterAuthModule } from "@thallesp/nestjs-better-auth";
import { ActivitiesModule } from "./activities/activities.module";
import { AdminModule } from "./admin/admin.module";
import { AgentModule } from "./agent/agent.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { BackfillModule } from "./backfill/backfill.module";
import { AppCacheModule } from "./cache/cache.module";
import { CompaniesModule } from "./companies/companies.module";
import { validateEnv } from "./config/env.validation";
import { ContactsModule } from "./contacts/contacts.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { CrmModule } from "./crm/crm.module";
import { CurrencyModule } from "./currency/currency.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DatabaseModule } from "./database/database.module";
import { DealsModule } from "./deals/deals.module";
import { EnrichmentModule } from "./enrichment/enrichment.module";
import { FieldsModule } from "./fields/fields.module";
import { GoogleModule } from "./google/google.module";
import { HealthModule } from "./health/health.module";
import { InvitesModule } from "./invites/invites.module";
import { LoggingModule } from "./logging/logging.module";
import { authRouteTenant } from "./auth/auth-route-tenant";
import { logAuthRoute } from "./logging/request-logger.middleware";
import { MailboxModule } from "./mailbox/mailbox.module";
import { MicrosoftModule } from "./microsoft/microsoft.module";
import { OrgsModule } from "./orgs/orgs.module";
import { SearchModule } from "./search/search.module";
import { SettingsModule } from "./settings/settings.module";
import { SlackModule } from "./slack/slack.module";
import { SsoModule } from "./sso/sso.module";
import { SyncModule } from "./sync/sync.module";
import { TelemetryModule } from "./telemetry/telemetry.module";
import { TrackingModule } from "./tracking/tracking.module";
import { TrpcModule } from "./trpc/trpc.module";
import { UsersModule } from "./users/users.module";
import { WorkspaceModule } from "./workspace/workspace.module";

@Module({
	imports: [
		LoggingModule,
		ConfigModule.forRoot({
			isGlobal: true,
			cache: true,
			validate: validateEnv,
		}),
		AppCacheModule,
		DatabaseModule,
		CrmModule,
		BetterAuthModule.forRoot({
			auth,
			middleware: (request, response, next) =>
				logAuthRoute(request, response, () =>
					authRouteTenant(request, response, next),
				),
		}),
		AuthModule,
		HealthModule,
		TrpcModule,
		AuditModule,
		OrgsModule,
		InvitesModule,
		AdminModule,
		UsersModule,
		CompaniesModule,
		ContactsModule,
		ConversationsModule,
		CurrencyModule,
		DealsModule,
		FieldsModule,
		ActivitiesModule,
		AgentModule,
		EnrichmentModule,
		DashboardModule,
		SearchModule,
		MailboxModule,
		GoogleModule,
		MicrosoftModule,
		SyncModule,
		SettingsModule,
		WorkspaceModule,
		SsoModule,
		SlackModule,
		BackfillModule,
		TelemetryModule,
		TrackingModule,
	],
})
export class AppModule {}

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthController } from '@gitroom/backend/api/routes/auth.controller';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { UsersController } from '@gitroom/backend/api/routes/users.controller';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { PaymentController } from '@gitroom/backend/api/routes/payment.controller';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';
import { PaymentProviderManager } from '@gitroom/nestjs-libraries/services/payment/payment.provider.manager';
import { RevenueCatProvider } from '@gitroom/nestjs-libraries/services/payment/providers/revenuecat.provider';
import { AnalyticsController } from '@gitroom/backend/api/routes/analytics.controller';
import { PoliciesGuard } from '@gitroom/backend/services/auth/permissions/permissions.guard';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { IntegrationsController } from '@gitroom/backend/api/routes/integrations.controller';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { SettingsController } from '@gitroom/backend/api/routes/settings.controller';
import { PostsController } from '@gitroom/backend/api/routes/posts.controller';
import { MediaController } from '@gitroom/backend/api/routes/media.controller';
import { ClippingController } from '@gitroom/backend/api/routes/clipping.controller';
import { MediaWidgetController } from '@gitroom/backend/api/routes/media.widget.controller';
import { UploadWidgetAuthMiddleware } from '@gitroom/backend/services/auth/upload.widget.auth.middleware';
import { ClippingWidgetController } from '@gitroom/backend/api/routes/clipping.widget.controller';
import { ClippingWidgetAuthMiddleware } from '@gitroom/backend/services/auth/clipping.widget.auth.middleware';
import { UploadModule } from '@gitroom/nestjs-libraries/upload/upload.module';
import { BillingController } from '@gitroom/backend/api/routes/billing.controller';
import { NotificationsController } from '@gitroom/backend/api/routes/notifications.controller';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { ExtractContentService } from '@gitroom/nestjs-libraries/openai/extract.content.service';
import { CodesService } from '@gitroom/nestjs-libraries/services/codes.service';
import { CopilotController } from '@gitroom/backend/api/routes/copilot.controller';
import { PublicController } from '@gitroom/backend/api/routes/public.controller';
import { RootController } from '@gitroom/backend/api/routes/root.controller';
import { HealthController } from '@gitroom/backend/api/routes/health.controller';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { WebhookController } from '@gitroom/backend/api/routes/webhooks.controller';
import { SignatureController } from '@gitroom/backend/api/routes/signature.controller';
import { BriefController } from '@gitroom/backend/api/routes/brief.controller';
import { HermesController } from '@gitroom/backend/api/routes/hermes.controller';
import { AutopostController } from '@gitroom/backend/api/routes/autopost.controller';
import { SetsController } from '@gitroom/backend/api/routes/sets.controller';
import { ThirdPartyController } from '@gitroom/backend/api/routes/third-party.controller';
import { MonitorController } from '@gitroom/backend/api/routes/monitor.controller';
import { NoAuthIntegrationsController } from '@gitroom/backend/api/routes/no.auth.integrations.controller';
import { OAuthAppController } from '@gitroom/backend/api/routes/oauth-app.controller';
import { ApprovedAppsController } from '@gitroom/backend/api/routes/approved-apps.controller';
import {
  OAuthController,
  OAuthAuthorizedController,
} from '@gitroom/backend/api/routes/oauth.controller';
import {
  DeviceController,
  DeviceAuthorizedController,
} from '@gitroom/backend/api/routes/device.controller';
import { DeviceAuthService } from '@gitroom/nestjs-libraries/database/prisma/device/device.auth.service';
import { AnnouncementsController } from '@gitroom/backend/api/routes/announcements.controller';
import { AdminController } from '@gitroom/backend/api/routes/admin.controller';
import { ProvisionController } from '@gitroom/backend/api/routes/provision.controller';
import { MediaMeterController } from '@gitroom/backend/api/routes/media-meter.controller';
import { AuthProviderManager } from '@gitroom/backend/services/auth/providers/providers.manager';
import { GithubProvider } from '@gitroom/backend/services/auth/providers/github.provider';
import { GoogleProvider } from '@gitroom/backend/services/auth/providers/google.provider';
import { AppleProvider } from '@gitroom/backend/services/auth/providers/apple.provider';
import { FarcasterProvider } from '@gitroom/backend/services/auth/providers/farcaster.provider';
import { WalletProvider } from '@gitroom/backend/services/auth/providers/wallet.provider';
import { OauthProvider } from '@gitroom/backend/services/auth/providers/oauth.provider';
import { StripeController } from '@gitroom/backend/api/routes/stripe.controller';

const authenticatedController = [
  UsersController,
  AnalyticsController,
  IntegrationsController,
  SettingsController,
  PostsController,
  MediaController,
  ClippingController,
  BillingController,
  NotificationsController,
  CopilotController,
  WebhookController,
  SignatureController,
  BriefController,
  HermesController,
  AutopostController,
  SetsController,
  ThirdPartyController,
  OAuthAppController,
  ApprovedAppsController,
  OAuthAuthorizedController,
  DeviceAuthorizedController,
  AnnouncementsController,
  AdminController,
  MediaMeterController,
];
@Module({
  imports: [UploadModule],
  // EnterpriseController (/enterprise/*) is deliberately not registered. It
  // authenticates callers with any JWT signed by JWT_SECRET rather than a
  // dedicated credential (GHSA-629m-99qx-356r), and this product does not use
  // the enterprise flow, so the routes stay closed.
  controllers: process.env.MCP_ONLY
    ? [
        RootController,
        HealthController,
        OAuthController,
        MediaWidgetController,
        ClippingWidgetController,
      ]
    : [
        RootController,
        HealthController,
        PaymentController,
        StripeController,
        AuthController,
        PublicController,
        // Guards itself with PROVISION_SECRET, so it stays out of
        // authenticatedController: the caller is a server, not a signed-in user.
        ProvisionController,
        MonitorController,
        NoAuthIntegrationsController,
        OAuthController,
        DeviceController,
        MediaWidgetController,
        ClippingWidgetController,
        ...authenticatedController,
      ],
  providers: [
    AuthService,
    StripeService,
    PaymentService,
    PaymentProviderManager,
    RevenueCatProvider,
    OpenaiService,
    ExtractContentService,
    DeviceAuthService,
    AuthMiddleware,
    UploadWidgetAuthMiddleware,
    PoliciesGuard,
    PermissionsService,
    CodesService,
    IntegrationManager,
    TrackService,
    ShortLinkService,
    AuthProviderManager,
    GithubProvider,
    GoogleProvider,
    AppleProvider,
    FarcasterProvider,
    WalletProvider,
    OauthProvider,
  ],
  get exports() {
    return [...this.imports, ...this.providers];
  },
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes(...authenticatedController);
    consumer.apply(UploadWidgetAuthMiddleware).forRoutes(MediaWidgetController);
    consumer
      .apply(ClippingWidgetAuthMiddleware)
      .forRoutes(ClippingWidgetController);
  }
}

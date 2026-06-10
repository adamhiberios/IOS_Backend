import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WebController } from './web.controller';

/**
 * WebModule — user-facing HTML pages for actions that arrive via email links.
 *
 * Lives at the root path (not under /api/v1) so email links like
 * `https://api.instituteofscrum.org/verify-email?token=...` resolve here.
 *
 * When a real web frontend ships, set FRONTEND_BASE_URL to the frontend's
 * origin and recipients land on the frontend pages instead — this module
 * stays in place as a fallback / for direct API users.
 */
@Module({
  imports: [AuthModule],
  controllers: [WebController],
})
export class WebModule {}

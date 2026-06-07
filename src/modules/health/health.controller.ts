import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminRole } from '../../database/entities';
import { StorageService } from '../storage/storage.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storage: StorageService,
  ) {}

  /**
   * Public liveness probe. Returns 200 with basic process info if the
   * process is running. No DB, Redis, or external dependency checks —
   * those would make this slow and would make a transient DB blip look
   * like the API is down to a load balancer.
   *
   * Safe to expose publicly. No sensitive info leaks.
   */
  @Public()
  @Get()
  @ApiOperation({
    summary: 'Lightweight health check (public)',
    description:
      'Returns 200 with process uptime + version. No dependencies checked. ' +
      'Use this for load balancer / uptime monitor probes.',
  })
  @ApiResponse({ status: 200, description: 'API is running' })
  check() {
    return {
      status: 'ok',
      version: process.env.npm_package_version ?? '0.0.1',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Deep health check — leaks internal connectivity status (DB, Redis,
   * external services) so MUST be authenticated. Restricted to super_admin
   * because at this stage we don't have a dedicated monitoring auth layer.
   * Week 7 adds an internal-only `/health/internal` with a separate static
   * token for monitoring tooling.
   */
  @Get('full')
  @UseGuards(RolesGuard)
  @Roles(AdminRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Deep health check (super_admin only)',
    description:
      'Returns connectivity status for DB and external services. ' +
      'Requires a valid super_admin JWT in the Authorization header. ' +
      'Other roles receive 403; missing/invalid token receives 401.',
  })
  @ApiResponse({ status: 200, description: 'Full health report' })
  @ApiResponse({ status: 401, description: 'Missing or invalid JWT' })
  @ApiResponse({ status: 403, description: 'Caller is not super_admin' })
  async checkFull() {
    let dbStatus = 'ok';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      dbStatus = 'error';
    }

    const storageBuckets = await this.storage.healthCheck();
    const storageStatus = Object.values(storageBuckets).every(Boolean)
      ? 'ok'
      : 'degraded';

    const overall =
      dbStatus === 'ok' && storageStatus === 'ok' ? 'ok' : 'degraded';

    return {
      status: overall,
      services: {
        database: dbStatus,
        storage: {
          status: storageStatus,
          buckets: storageBuckets,
        },
        // Redis + Stripe + SendGrid checks added in Week 7 (BE-040)
      },
      version: process.env.npm_package_version ?? '0.0.1',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}

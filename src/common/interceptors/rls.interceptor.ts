import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { Observable, from, lastValueFrom } from 'rxjs';
import type { Request } from 'express';

export interface AuthenticatedUser {
  /** UUID of the user (students). */
  id?: string;
  /** UUID of the admin (staff). */
  adminId?: string;
  type?: 'student' | 'admin';
  role?: string;
  email?: string;
  locale?: string;
}

export interface RlsRequest extends Request {
  rlsRunner?: QueryRunner;
  user?: AuthenticatedUser;
}

/**
 * RlsInterceptor — for each authenticated request, opens a dedicated
 * QueryRunner inside a transaction, sets session-local variables for RLS
 * policies, then attaches the runner to the request so service code can
 * use it for RLS-protected queries.
 *
 * Variables set via set_config(..., true) — session-local, transaction-scoped.
 * Commits on successful handler completion, rolls back on thrown error.
 * Runner is always released.
 *
 * Unauthenticated requests bypass this entirely (no transaction overhead).
 */
@Injectable()
export class RlsInterceptor implements NestInterceptor {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<RlsRequest>();
    const user = req.user;

    if (!user || (!user.id && !user.adminId)) {
      return next.handle();
    }

    return from(this.runWithRlsContext(req, user, next));
  }

  private async runWithRlsContext(
    req: RlsRequest,
    user: AuthenticatedUser,
    next: CallHandler,
  ): Promise<unknown> {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      '127.0.0.1';

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (user.id) {
        await queryRunner.query(
          `SELECT set_config('app.current_user_id', $1, true)`,
          [String(user.id)],
        );
      }
      if (user.adminId) {
        await queryRunner.query(
          `SELECT set_config('app.current_admin_id', $1, true)`,
          [String(user.adminId)],
        );
      }
      await queryRunner.query(`SELECT set_config('app.current_ip', $1, true)`, [
        ip,
      ]);

      req.rlsRunner = queryRunner;

      const result: unknown = await lastValueFrom(next.handle());
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw err;
    } finally {
      if (!queryRunner.isReleased) {
        await queryRunner.release();
      }
    }
  }
}

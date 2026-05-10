import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Observable } from 'rxjs';
import { Request } from 'express';

/**
 * RlsInterceptor — wraps every authenticated request in a transaction and
 * sets session-local variables for RLS policies.
 *
 * SET LOCAL app.current_user_id = $userId
 * SET LOCAL app.current_admin_id = $adminId
 * SET LOCAL app.current_ip = $ip
 *
 * PgBouncer in transaction-pooling mode preserves SET LOCAL variables
 * for the duration of the transaction, then resets them — no cross-request
 * leakage.
 *
 * NOTE: This interceptor only sets the variables. The TypeORM DataSource
 * used within the request must participate in the same transaction for
 * RLS to take effect. Use QueryRunner directly for RLS-protected tables.
 */
@Injectable()
export class RlsInterceptor implements NestInterceptor {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<Request>();
    const user = (req as Request & { user?: { id?: number; adminId?: number } }).user;

    if (!user) {
      return next.handle();
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? req.socket.remoteAddress
      ?? '';

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (user.id) {
        await queryRunner.query(
          `SET LOCAL app.current_user_id = $1`,
          [String(user.id)],
        );
      }
      if (user.adminId) {
        await queryRunner.query(
          `SET LOCAL app.current_admin_id = $1`,
          [String(user.adminId)],
        );
      }
      if (ip) {
        await queryRunner.query(
          `SET LOCAL app.current_ip = $1`,
          [ip],
        );
      }

      // Attach queryRunner to request so services can use it for RLS-protected queries
      (req as Request & { rlsRunner?: typeof queryRunner }).rlsRunner = queryRunner;

      return next.handle();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.commitTransaction();
      await queryRunner.release();
    }
  }
}

import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * StorageModule is `@Global()` because every feature module that touches
 * uploads, cert PDFs, lesson videos, or avatars will inject StorageService.
 * Marking it global avoids each feature module needing to `imports:
 * [StorageModule]` boilerplate.
 *
 * The service itself is stateless past its DI'd config — a single instance
 * for the whole app is correct.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}

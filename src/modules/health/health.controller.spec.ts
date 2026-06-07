import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';

import { HealthController } from './health.controller';
import { StorageService } from '../storage/storage.service';
import { BucketKind } from '../storage/storage.types';

describe('HealthController', () => {
  let controller: HealthController;
  let dataSource: { query: jest.Mock };
  let storage: { healthCheck: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };
    storage = {
      healthCheck: jest.fn().mockResolvedValue({
        [BucketKind.CERTIFICATES]: true,
        [BucketKind.MEDIA]: true,
        [BucketKind.VIDEOS]: true,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: getDataSourceToken(),
          useValue: dataSource,
        },
        {
          provide: StorageService,
          useValue: storage,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('check', () => {
    it('returns ok status without touching the database or storage', () => {
      const result = controller.check();
      expect(result.status).toBe('ok');
      expect(result.timestamp).toEqual(expect.any(String));
      expect(typeof result.uptime).toBe('number');
      expect(dataSource.query).not.toHaveBeenCalled();
      expect(storage.healthCheck).not.toHaveBeenCalled();
    });
  });

  describe('checkFull', () => {
    it('reports ok when database and every bucket are reachable', async () => {
      dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
      const result = await controller.checkFull();
      expect(result.status).toBe('ok');
      expect(result.services.database).toBe('ok');
      expect(result.services.storage.status).toBe('ok');
      expect(result.services.storage.buckets).toMatchObject({
        certificates: true,
        media: true,
        videos: true,
      });
    });

    it('reports degraded when the database query throws', async () => {
      dataSource.query.mockRejectedValue(new Error('connection refused'));
      const result = await controller.checkFull();
      expect(result.status).toBe('degraded');
      expect(result.services.database).toBe('error');
    });

    it('reports degraded when any storage bucket is unreachable', async () => {
      dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
      storage.healthCheck.mockResolvedValue({
        certificates: true,
        media: false,
        videos: true,
      });
      const result = await controller.checkFull();
      expect(result.status).toBe('degraded');
      expect(result.services.storage.status).toBe('degraded');
      expect(result.services.storage.buckets.media).toBe(false);
    });
  });
});

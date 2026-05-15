import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: getDataSourceToken(),
          useValue: dataSource,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('check', () => {
    it('returns ok status without touching the database', () => {
      const result = controller.check();
      expect(result.status).toBe('ok');
      expect(result.timestamp).toEqual(expect.any(String));
      expect(typeof result.uptime).toBe('number');
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('checkFull', () => {
    it('reports ok when database is reachable', async () => {
      dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
      const result = await controller.checkFull();
      expect(result.status).toBe('ok');
      expect(result.services.database).toBe('ok');
    });

    it('reports degraded when database query throws', async () => {
      dataSource.query.mockRejectedValue(new Error('connection refused'));
      const result = await controller.checkFull();
      expect(result.status).toBe('degraded');
      expect(result.services.database).toBe('error');
    });
  });
});

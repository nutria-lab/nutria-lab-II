import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessGateMiddleware } from './access-gate.middleware';
import { AccessGateService } from './access-gate.service';

@Module({
  controllers: [AccessController],
  providers: [AccessGateService, AccessGateMiddleware],
  exports: [AccessGateService],
})
export class AccessModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(AccessGateMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
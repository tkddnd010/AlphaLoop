import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TossApiController } from './toss-api.controller.js';
import { TossApiService } from './toss-api.service.js';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10_000,
      maxRedirects: 3,
    }),
  ],
  controllers: [TossApiController],
  providers: [TossApiService],
  exports: [TossApiService],
})
export class TossApiModule {}

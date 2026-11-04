import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DartService } from './dart.service.js';
import { DartController } from './dart.controller.js';
import { WatchListModule } from '../watchlist/watchlist.module.js';

@Module({
  imports: [HttpModule, WatchListModule],
  controllers: [DartController],
  providers: [DartService],
  exports: [DartService], // 다른 모듈에서 사용 가능
})
export class DartModule {}

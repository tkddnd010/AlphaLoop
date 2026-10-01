import { Module } from '@nestjs/common';
import { WatchListService } from './watchlist.service.js';
import { WatchListController } from './watchlist.controller.js';
import { TossApiModule } from '../toss-api/toss-api.module.js';
import { SlackModule } from '../slack/slack.module.js';

@Module({
  imports: [TossApiModule, SlackModule],
  controllers: [WatchListController],
  providers: [WatchListService],
  exports: [WatchListService], // 다른 모듈에서 사용 가능
})
export class WatchListModule {}

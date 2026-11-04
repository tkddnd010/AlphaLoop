import { Module } from '@nestjs/common';
import { DailySchedulerService } from './daily-scheduler.service.js';
import { IntradayExitService } from './intraday-exit.service.js';
import { JobsController } from './jobs.controller.js';
import { LLMModule } from '../llm/llm.module.js';
import { TossApiModule } from '../toss-api/toss-api.module.js';
import { SlackModule } from '../slack/slack.module.js';
import { DartModule } from '../dart/dart.module.js';
import { WatchListModule } from '../watchlist/watchlist.module.js';

@Module({
  imports: [LLMModule, TossApiModule, SlackModule, DartModule, WatchListModule],
  controllers: [JobsController],
  providers: [DailySchedulerService, IntradayExitService],
})
export class JobsModule {}

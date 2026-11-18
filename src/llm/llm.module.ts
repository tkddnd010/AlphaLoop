import { Module } from '@nestjs/common';
import { LLMService } from './llm.service.js';
import { LLMController } from './llm.controller.js';
import { WatchlistAnalysisService } from './watchlist-analysis.service.js';
import { DartModule } from '../dart/dart.module.js';
import { TossApiModule } from '../toss-api/toss-api.module.js';
import { WatchListModule } from '../watchlist/watchlist.module.js';
import { SlackModule } from '../slack/slack.module.js';
import { NaverFinanceModule } from '../naver-finance/naver-finance.module.js';

@Module({
  imports: [DartModule, TossApiModule, WatchListModule, SlackModule, NaverFinanceModule],
  controllers: [LLMController],
  providers: [LLMService, WatchlistAnalysisService],
  exports: [LLMService, WatchlistAnalysisService],
})
export class LLMModule {}

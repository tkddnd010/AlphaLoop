import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TossApiModule } from './toss-api/toss-api.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SlackModule } from './slack/slack.module.js';
import { WatchListModule } from './watchlist/watchlist.module.js';
import { DartModule } from './dart/dart.module.js';
import { LLMModule } from './llm/llm.module.js';
import { JobsModule } from './jobs/jobs.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    TossApiModule,
    SlackModule,
    WatchListModule,
    DartModule,
    LLMModule,
    JobsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TossApiModule } from './toss-api/toss-api.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SlackModule } from './slack/slack.module.js';
import { WatchListModule } from './watchlist/watchlist.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    TossApiModule,
    SlackModule,
    WatchListModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

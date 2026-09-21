import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TossApiModule } from './toss-api/toss-api.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TossApiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

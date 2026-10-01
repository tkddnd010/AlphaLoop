import { Module } from '@nestjs/common';
import { SlackService } from './slack.service.js';
import { SlackController } from './slack.controller.js';
import { TossApiModule } from '../toss-api/toss-api.module.js';

@Module({
  imports: [TossApiModule], // TossApiService를 사용하기 위해 import
  controllers: [SlackController],
  providers: [SlackService],
  exports: [SlackService], // 다른 모듈에서 SlackService를 사용할 수 있도록 export
})
export class SlackModule {}

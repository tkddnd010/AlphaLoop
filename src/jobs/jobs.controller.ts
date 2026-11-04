import { Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { IntradayExitService } from './intraday-exit.service.js';

@Controller('jobs')
export class JobsController {
  constructor(private readonly intradayExit: IntradayExitService) {}

  /**
   * 테스트용: 손절 + 위험 공시 매도를 한 번 실행
   * POST /jobs/intraday-exits
   */
  @Post('intraday-exits')
  @HttpCode(HttpStatus.OK)
  runIntradayExits() {
    return this.intradayExit.runAll();
  }
}

import { Controller, Get, Param, Query } from '@nestjs/common';
import { NaverFinanceService } from './naver-finance.service.js';

@Controller('naver-finance')
export class NaverFinanceController {
  constructor(
    private readonly naverFinanceService: NaverFinanceService,
  ) {}

  /**
   * GET /naver-finance/candles/:symbol?days=60
   * 일봉 데이터 조회 테스트
   */
  @Get('candles/:symbol')
  async getCandles(
    @Param('symbol') symbol: string,
    @Query('days') days?: string,
  ) {
    const daysNum = days ? parseInt(days, 10) : 60;
    const candles = await this.naverFinanceService.getDailyCandles(
      symbol,
      daysNum,
    );

    return {
      symbol,
      days: daysNum,
      count: candles.length,
      data: candles,
    };
  }

  /**
   * GET /naver-finance/technical/:symbol
   * 기술적 지표 계산 테스트
   */
  @Get('technical/:symbol')
  async getTechnical(
    @Param('symbol') symbol: string,
    @Query('price') price?: string,
  ) {
    const currentPrice = price ? parseFloat(price) : 0;
    
    if (currentPrice <= 0) {
      return {
        error: '현재가(price)를 쿼리 파라미터로 전달해주세요',
        example: `/naver-finance/technical/${symbol}?price=50000`,
      };
    }

    const score = await this.naverFinanceService.calculateTechnicalScore(
      symbol,
      currentPrice,
    );

    return score;
  }
}

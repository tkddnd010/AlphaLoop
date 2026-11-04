import { Controller, Get, Query, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { DartService } from './dart.service.js';
import { WatchListService } from '../watchlist/watchlist.service.js';

@Controller('dart')
export class DartController {
  constructor(
    private readonly dartService: DartService,
    private readonly watchlistService: WatchListService,
  ) {}

  /**
   * 특정 종목의 최근 공시 조회
   * GET /dart/disclosures/:stockCode?days=30
   */
  @Get('disclosures/:stockCode')
  @HttpCode(HttpStatus.OK)
  async getDisclosures(
    @Param('stockCode') stockCode: string,
    @Query('days') days?: string,
  ) {
    const daysNum = days ? parseInt(days, 10) : 30;
    const disclosures = await this.dartService.getRecentDisclosures(
      stockCode,
      daysNum,
    );

    return {
      success: true,
      stockCode,
      period: `${daysNum}일`,
      count: disclosures.length,
      disclosures,
    };
  }

  /**
   * 관심 종목 전체의 최근 공시 조회
   * GET /dart/watchlist-disclosures?days=30
   */
  @Get('watchlist-disclosures')
  @HttpCode(HttpStatus.OK)
  async getWatchListDisclosures(@Query('days') days?: string) {
    const daysNum = days ? parseInt(days, 10) : 30;
    const symbols = this.watchlistService.getSymbols();

    const summaries = await this.dartService.getMultipleStockDisclosures(
      symbols,
      daysNum,
    );

    return {
      success: true,
      period: `${daysNum}일`,
      totalStocks: symbols.length,
      summaries,
    };
  }

  /**
   * 공시 내용 요약 (LLM 분석용 텍스트)
   * GET /dart/summary/:stockCode?days=30
   */
  @Get('summary/:stockCode')
  @HttpCode(HttpStatus.OK)
  async getDisclosureSummary(
    @Param('stockCode') stockCode: string,
    @Query('days') days?: string,
  ) {
    const daysNum = days ? parseInt(days, 10) : 30;
    const disclosures = await this.dartService.getRecentDisclosures(
      stockCode,
      daysNum,
    );

    const summary = this.dartService.generateDisclosureSummary(disclosures);

    return {
      success: true,
      stockCode,
      summary,
      disclosuresCount: disclosures.length,
    };
  }
}

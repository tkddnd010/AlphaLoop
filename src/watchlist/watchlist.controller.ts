import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { WatchListService } from './watchlist.service.js';
import { SlackService } from '../slack/slack.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('watchlist')
export class WatchListController {
  constructor(
    private readonly watchlistService: WatchListService,
    private readonly slackService: SlackService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 관심 종목 리스트 조회
   * GET /watchlist
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getWatchList() {
    const symbols = this.watchlistService.getSymbols();
    return {
      success: true,
      count: symbols.length,
      symbols,
    };
  }

  /**
   * 관심 종목 전체 현재가 조회
   * GET /watchlist/prices
   */
  @Get('prices')
  @HttpCode(HttpStatus.OK)
  async getAllPrices() {
    const prices = await this.watchlistService.getAllCurrentPrices();
    return {
      success: true,
      count: prices.length,
      data: prices,
    };
  }

  /**
   * 관심 종목 요약 정보
   * GET /watchlist/summary
   */
  @Get('summary')
  @HttpCode(HttpStatus.OK)
  async getSummary() {
    const summary = await this.watchlistService.getSummary();
    return {
      success: true,
      data: summary,
    };
  }

  /**
   * 예산 내에서 매수 가능한 종목 조회
   * POST /watchlist/affordable
   * Body: { "budget": 100000 }
   */
  @Post('affordable')
  @HttpCode(HttpStatus.OK)
  async getAffordableSymbols(@Body() body: { budget: number }) {
    const affordable = await this.watchlistService.getAffordableSymbols(body.budget);
    return {
      success: true,
      budget: body.budget,
      count: affordable.length,
      data: affordable,
    };
  }

  /**
   * 관심 종목 전체에 대해 테스트용 매수 추천 메시지 전송
   * POST /watchlist/send-all-recommendations
   * Body: { "reason": "테스트용 일괄 추천" }
   */
  @Post('send-all-recommendations')
  @HttpCode(HttpStatus.OK)
  async sendAllRecommendations(
    @Body() body: { reason?: string; llmScore?: number },
  ) {
    const prices = await this.watchlistService.getAllCurrentPrices();
    const results = [];

    for (const stock of prices) {
      if (!stock.isValid || !stock.currentPrice) {
        results.push({
          success: false,
          symbol: stock.symbol,
          error: stock.error || '현재가 조회 실패',
        });
        continue;
      }

      try {
        // StrategyLog 생성
        const strategyLog = await this.prisma.strategyLog.create({
          data: {
            symbol: stock.symbol,
            dartId: null,
            llmScore: body.llmScore || 8,
            reason: body.reason || `${stock.companyName || stock.symbol} 종목 분석 결과 매수 추천`,
            decision: 'BUY',
            isApproved: false,
          },
        });

        // Slack 메시지 전송
        const messageTs = await this.slackService.sendBuyApprovalMessage({
          strategyLogId: strategyLog.id,
          symbol: stock.symbol,
          companyName: stock.companyName,
          currentPrice: stock.currentPrice,
          reason: strategyLog.reason,
          llmScore: strategyLog.llmScore,
          dartId: undefined,
        });

        results.push({
          success: true,
          symbol: stock.symbol,
          companyName: stock.companyName,
          currentPrice: stock.currentPrice,
          strategyLogId: strategyLog.id,
          messageTs,
        });
      } catch (error) {
        results.push({
          success: false,
          symbol: stock.symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;

    return {
      success: true,
      message: `${successCount}/${results.length} 메시지 전송 완료`,
      results,
    };
  }

  /**
   * 특정 종목만 추천 메시지 전송
   * POST /watchlist/send-recommendation
   * Body: { "symbol": "033170", "reason": "..." }
   */
  @Post('send-recommendation')
  @HttpCode(HttpStatus.OK)
  async sendRecommendation(
    @Body() body: { symbol: string; reason: string; llmScore?: number },
  ) {
    // 관심 종목인지 확인
    if (!this.watchlistService.isWatchListSymbol(body.symbol)) {
      return {
        success: false,
        message: `${body.symbol}은(는) 관심 종목이 아닙니다.`,
        watchlist: this.watchlistService.getSymbols(),
      };
    }

    const prices = await this.watchlistService.getAllCurrentPrices();
    const stock = prices.find((p) => p.symbol === body.symbol);

    if (!stock || !stock.isValid || !stock.currentPrice) {
      return {
        success: false,
        message: `${body.symbol} 현재가 조회 실패`,
        error: stock?.error,
      };
    }

    // StrategyLog 생성
    const strategyLog = await this.prisma.strategyLog.create({
      data: {
        symbol: body.symbol,
        dartId: null,
        llmScore: body.llmScore || 8,
        reason: body.reason,
        decision: 'BUY',
        isApproved: false,
      },
    });

    // Slack 메시지 전송
    const messageTs = await this.slackService.sendBuyApprovalMessage({
      strategyLogId: strategyLog.id,
      symbol: body.symbol,
      companyName: stock.companyName,
      currentPrice: stock.currentPrice,
      reason: body.reason,
      llmScore: strategyLog.llmScore,
      dartId: undefined,
    });

    return {
      success: true,
      message: 'Slack 메시지 전송 완료',
      data: {
        symbol: body.symbol,
        companyName: stock.companyName,
        currentPrice: stock.currentPrice,
        strategyLogId: strategyLog.id,
        messageTs,
      },
    };
  }
}

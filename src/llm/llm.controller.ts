import { Controller, Post, Body, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { LLMService } from './llm.service.js';
import { WatchlistAnalysisService } from './watchlist-analysis.service.js';
import { DartService } from '../dart/dart.service.js';
import { TossApiService } from '../toss-api/toss-api.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AnalysisInput } from './interfaces/llm.interface.js';

@Controller('llm')
export class LLMController {
  constructor(
    private readonly llmService: LLMService,
    private readonly watchlistAnalysis: WatchlistAnalysisService,
    private readonly dartService: DartService,
    private readonly tossApiService: TossApiService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 특정 종목 분석
   * POST /llm/analyze
   * Body: { "stockCode": "033170", "days": 30 }
   */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyzeStock(@Body() body: { stockCode: string; days?: number }) {
    const days = body.days || 30;

    // 1. 공시 조회
    const disclosures = await this.dartService.getRecentDisclosures(
      body.stockCode,
      days,
    );
    const disclosureSummary = await this.dartService.generateDisclosureSummaryAsync(disclosures);

    // 2. 현재가 조회 (실패 시 0으로 두고 공시만으로 분석 — 배치 분석과 동일한 동작)
    let currentPrice = 0;
    try {
      const priceInfo = await this.tossApiService.getCurrentPrice(body.stockCode);
      currentPrice = priceInfo.currentPrice;
    } catch {
      console.warn(`${body.stockCode} 현재가 조회 실패 (IP 미등록 가능성), 공시만으로 분석 진행`);
    }

    // 3. LLM 분석
    const analysisInput: AnalysisInput = {
      stockCode: body.stockCode,
      companyName: disclosures[0]?.corp_name || body.stockCode,
      currentPrice,
      disclosures: disclosureSummary,
    };

    const result = await this.llmService.analyzeStock(analysisInput);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 관심 종목 전체 분석 + Slack 전송 (점수 7점 이상만)
   * POST /llm/analyze-watchlist
   * Body: { "days": 30, "minScore": 7, "sendToSlack": true }
   */
  @Post('analyze-watchlist')
  @HttpCode(HttpStatus.OK)
  async analyzeWatchList(
    @Body() body: { days?: number; minScore?: number; sendToSlack?: boolean },
  ) {
    return this.watchlistAnalysis.analyzeWatchList({
      days: body.days,
      minScore: body.minScore,
      sendToSlack: body.sendToSlack,
    });
  }

  /**
   * 과거 분석 결과 조회
   * GET /llm/history?limit=10
   */
  @Get('history')
  @HttpCode(HttpStatus.OK)
  async getAnalysisHistory(@Body() query: { limit?: number }) {
    const limit = query.limit || 10;

    const logs = await this.prisma.strategyLog.findMany({
      orderBy: { analyzedAt: 'desc' },
      take: limit,
    });

    return {
      success: true,
      count: logs.length,
      data: logs,
    };
  }
}

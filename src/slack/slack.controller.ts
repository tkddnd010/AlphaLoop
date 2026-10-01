import { Body, Controller, Post, HttpStatus, HttpCode } from '@nestjs/common';
import { SlackService } from './slack.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TossApiService } from '../toss-api/toss-api.service.js';
import type { BuyRecommendation } from './interfaces/slack.interface.js';

@Controller('slack')
export class SlackController {
  constructor(
    private readonly slackService: SlackService,
    private readonly prisma: PrismaService,
    private readonly tossApiService: TossApiService,
  ) {}

  /**
   * 테스트용: 매수 추천 메시지를 Slack으로 전송
   * POST /slack/test-approval
   * 
   * Body:
   * {
   *   "symbol": "005930",
   *   "companyName": "삼성전자",
   *   "reason": "LLM이 이 종목을 추천합니다."
   * }
   */
  @Post('test-approval')
  @HttpCode(HttpStatus.OK)
  async testApprovalMessage(
    @Body() body: { symbol: string; companyName?: string; reason: string },
  ) {
    // 1. 현재가 조회
    const priceInfo = await this.tossApiService.getCurrentPrice(body.symbol);

    // 2. StrategyLog 생성 (테스트용)
    const strategyLog = await this.prisma.strategyLog.create({
      data: {
        symbol: body.symbol,
        dartId: undefined,
        llmScore: 8, // 테스트용 점수
        reason: body.reason,
        decision: 'BUY',
        isApproved: false,
      },
    });

    // 3. Slack 메시지 전송
    const recommendation: BuyRecommendation = {
      strategyLogId: strategyLog.id,
      symbol: body.symbol,
      companyName: body.companyName,
      currentPrice: priceInfo.currentPrice,
      reason: body.reason,
      llmScore: 8,
      dartId: undefined,
    };

    const messageTs = await this.slackService.sendBuyApprovalMessage(
      recommendation,
    );

    return {
      success: true,
      message: 'Slack 메시지 전송 완료',
      data: {
        strategyLogId: strategyLog.id,
        messageTs,
        symbol: body.symbol,
        currentPrice: priceInfo.currentPrice,
      },
    };
  }

  /**
   * 테스트용: 여러 종목의 추천 메시지를 한 번에 전송
   * POST /slack/test-batch-approval
   * 
   * Body:
   * {
   *   "recommendations": [
   *     { "symbol": "005930", "companyName": "삼성전자", "reason": "..." },
   *     { "symbol": "035720", "companyName": "카카오", "reason": "..." }
   *   ]
   * }
   */
  @Post('test-batch-approval')
  @HttpCode(HttpStatus.OK)
  async testBatchApproval(
    @Body() body: { 
      recommendations: Array<{ 
        symbol: string; 
        companyName?: string; 
        reason: string 
      }> 
    },
  ) {
    const results = [];

    for (const rec of body.recommendations) {
      try {
        // 현재가 조회
        const priceInfo = await this.tossApiService.getCurrentPrice(rec.symbol);

        // StrategyLog 생성
        const strategyLog = await this.prisma.strategyLog.create({
          data: {
            symbol: rec.symbol,
            dartId: undefined,
            llmScore: Math.floor(Math.random() * 3) + 7, // 7~9점 랜덤
            reason: rec.reason,
            decision: 'BUY',
            isApproved: false,
          },
        });

        // Slack 메시지 전송
        const recommendation: BuyRecommendation = {
          strategyLogId: strategyLog.id,
          symbol: rec.symbol,
          companyName: rec.companyName,
          currentPrice: priceInfo.currentPrice,
          reason: rec.reason,
          llmScore: strategyLog.llmScore,
          dartId: undefined,
        };

        const messageTs = await this.slackService.sendBuyApprovalMessage(
          recommendation,
        );

        results.push({
          success: true,
          symbol: rec.symbol,
          strategyLogId: strategyLog.id,
          messageTs,
        });
      } catch (error) {
        results.push({
          success: false,
          symbol: rec.symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: true,
      message: `${results.filter(r => r.success).length}/${results.length} 메시지 전송 완료`,
      results,
    };
  }

  /**
   * 승인 대기 중인 전략 로그 목록 조회
   * GET /slack/pending-approvals
   */
  @Post('pending-approvals')
  @HttpCode(HttpStatus.OK)
  async getPendingApprovals() {
    const pendingLogs = await this.prisma.strategyLog.findMany({
      where: {
        isApproved: false,
        decision: 'BUY',
      },
      orderBy: {
        analyzedAt: 'desc',
      },
      take: 10,
    });

    return {
      success: true,
      count: pendingLogs.length,
      data: pendingLogs,
    };
  }
}

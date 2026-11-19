import { Injectable, Logger } from '@nestjs/common';
import { LLMService } from './llm.service.js';
import { DartService } from '../dart/dart.service.js';
import { TossApiService } from '../toss-api/toss-api.service.js';
import { WatchListService } from '../watchlist/watchlist.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SlackService } from '../slack/slack.service.js';
import { NaverFinanceService } from '../naver-finance/naver-finance.service.js';
import type { AnalysisInput, StockAnalysisResult } from './interfaces/llm.interface.js';

export interface WatchlistAnalysisRun {
  success: true;
  analyzed: number;
  highScoreCount: number;
  savedToDb: number;
  sentToSlack: number;
  results: StockAnalysisResult[];
  slackResults: Array<{
    symbol: string;
    sent: boolean;
    messageTs?: string;
    error?: string;
  }>;
}

@Injectable()
export class WatchlistAnalysisService {
  private readonly logger = new Logger(WatchlistAnalysisService.name);

  constructor(
    private readonly llmService: LLMService,
    private readonly dartService: DartService,
    private readonly tossApiService: TossApiService,
    private readonly watchlistService: WatchListService,
    private readonly prisma: PrismaService,
    private readonly slackService: SlackService,
    private readonly naverFinanceService: NaverFinanceService,
  ) {}

  async analyzeWatchList(options?: {
    days?: number;
    minScore?: number;
    sendToSlack?: boolean;
  }): Promise<WatchlistAnalysisRun> {
    const days = options?.days ?? 30;
    const minScore = options?.minScore ?? 7;
    const sendToSlack = options?.sendToSlack !== false;

    const symbols = this.watchlistService.getSymbols();
    const analysisInputs: AnalysisInput[] = [];

    for (const symbol of symbols) {
      try {
        const disclosures = await this.dartService.getRecentDisclosures(symbol, days);
        const disclosureSummary =
          await this.dartService.generateDisclosureSummaryAsync(disclosures);

        let currentPrice = 0;
        try {
          const priceInfo = await this.tossApiService.getCurrentPrice(symbol);
          currentPrice = priceInfo.currentPrice;
        } catch {
          this.logger.warn(`${symbol} 현재가 조회 실패, 공시만으로 분석 진행`);
        }

        analysisInputs.push({
          stockCode: symbol,
          companyName: disclosures[0]?.corp_name || symbol,
          currentPrice,
          disclosures: disclosureSummary,
        });
      } catch (error) {
        this.logger.error(`${symbol} 데이터 수집 실패: ${error}`);
      }
    }

    // 공시 기반 LLM 분석
    const batchResult = await this.llmService.analyzeBatch(analysisInputs);

    // 기술적 지표 계산 및 복합 점수 적용
    const enhancedResults: StockAnalysisResult[] = [];
    for (const result of batchResult.results) {
      try {
        const technicalScore = await this.naverFinanceService.calculateTechnicalScore(
          result.stockCode,
          result.currentPrice,
        );

        // 최종 점수 = 공시 30% + 기술적 70%
        const disclosureScore = result.score; // 공시 점수 (0~10)
        const finalScore = Math.round(
          disclosureScore * 0.3 + technicalScore.score * 0.7,
        );

        // 이유에 기술적 신호 추가
        const techSignals = technicalScore.signals.length > 0
          ? `\n📊 기술적 신호: ${technicalScore.signals.join(', ')}`
          : '';
        const techWarnings = technicalScore.warnings.length > 0
          ? `\n⚠️ 주의: ${technicalScore.warnings.join(', ')}`
          : '';

        enhancedResults.push({
          ...result,
          score: finalScore,
          reason: result.reason + techSignals + techWarnings,
        });

        this.logger.log(
          `${result.stockCode} 점수: 공시 ${disclosureScore}점 → ` +
          `기술적 ${technicalScore.score}점 → 최종 ${finalScore}점`,
        );
      } catch (error) {
        this.logger.error(
          `${result.stockCode} 기술적 지표 계산 실패, 공시 점수만 사용: ${error}`,
        );
        // 기술적 지표 실패 시 공시 점수만 사용 (복합 점수 없음)
        enhancedResults.push({
          ...result,
          reason: result.reason + '\n⚠️ 기술적 지표 계산 실패 (공시 점수만 사용)',
        });
      }
    }

    // 고득점 종목 필터링
    const highScoreStocks = enhancedResults.filter((r) => r.score >= minScore);

    const savedLogs: Array<StockAnalysisResult & { strategyLogId: number }> = [];
    for (const result of highScoreStocks) {
      const strategyLog = await this.prisma.strategyLog.create({
        data: {
          symbol: result.stockCode,
          dartId: null,
          llmScore: result.score,
          reason: result.reason,
          decision: result.recommendation,
          isApproved: false,
        },
      });
      savedLogs.push({ ...result, strategyLogId: strategyLog.id });
    }

    const slackResults: WatchlistAnalysisRun['slackResults'] = [];
    if (sendToSlack) {
      await this.slackService.sendWatchlistBriefing(enhancedResults);

      for (const log of savedLogs) {
        try {
          const messageTs = await this.slackService.sendBuyApprovalMessage({
            strategyLogId: log.strategyLogId,
            symbol: log.stockCode,
            companyName: log.companyName,
            currentPrice: log.currentPrice,
            reason: log.reason,
            llmScore: log.score,
            dartId: undefined,
          });

          if (!messageTs) {
            slackResults.push({
              symbol: log.stockCode,
              sent: false,
              error: '예수금으로 1주를 살 수 없어 슬랙 알림을 보내지 않음',
            });
            continue;
          }

          slackResults.push({
            symbol: log.stockCode,
            sent: true,
            messageTs,
          });
        } catch (error) {
          slackResults.push({
            symbol: log.stockCode,
            sent: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return {
      success: true,
      analyzed: batchResult.totalAnalyzed,
      highScoreCount: highScoreStocks.length,
      savedToDb: savedLogs.length,
      sentToSlack: slackResults.filter((item) => item.sent).length,
      results: enhancedResults,
      slackResults,
    };
  }
}

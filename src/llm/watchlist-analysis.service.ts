import { Injectable, Logger } from '@nestjs/common';
import { LLMService } from './llm.service.js';
import { DartService } from '../dart/dart.service.js';
import { TossApiService } from '../toss-api/toss-api.service.js';
import { WatchListService } from '../watchlist/watchlist.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SlackService } from '../slack/slack.service.js';
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

    const batchResult = await this.llmService.analyzeBatch(analysisInputs);

    const savedLogs: Array<StockAnalysisResult & { strategyLogId: number }> = [];
    for (const result of batchResult.highScoreStocks) {
      if (result.score < minScore) continue;
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
      await this.slackService.sendWatchlistBriefing(batchResult.results);

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
      highScoreCount: batchResult.highScoreStocks.length,
      savedToDb: savedLogs.length,
      sentToSlack: slackResults.filter((item) => item.sent).length,
      results: batchResult.results,
      slackResults,
    };
  }
}

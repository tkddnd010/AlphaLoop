import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WatchlistAnalysisService } from '../llm/watchlist-analysis.service.js';
import { TossApiService } from '../toss-api/toss-api.service.js';
import { SlackService } from '../slack/slack.service.js';
import { IntradayExitService } from './intraday-exit.service.js';

@Injectable()
export class DailySchedulerService {
  private readonly logger = new Logger(DailySchedulerService.name);

  constructor(
    private readonly watchlistAnalysis: WatchlistAnalysisService,
    private readonly tossApiService: TossApiService,
    private readonly slackService: SlackService,
    private readonly intradayExit: IntradayExitService,
  ) {}

  /**
   * 평일 00:10 KST — 자정 이후 공시 분석 + 슬랙 매수 결재
   */
  @Cron('10 0 * * 1-5', { timeZone: 'Asia/Seoul' })
  async analyzeAfterMidnight(): Promise<void> {
    try {
      this.logger.log('자정 이후 관심종목 분석 시작');
      const result = await this.watchlistAnalysis.analyzeWatchList({
        sendToSlack: true,
      });
      this.logger.log(
        `자정 분석 완료: ${result.analyzed}종목, 슬랙 결재 ${result.sentToSlack}건`,
      );
    } catch (error) {
      this.logger.error(
        `자정 분석 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 평일 09:00 KST — 당일 승인분 예수금 균등 매수
   */
  @Cron('0 9 * * 1-5', { timeZone: 'Asia/Seoul' })
  async executeApprovedBuysAtOpen(): Promise<void> {
    try {
      const market = await this.tossApiService.getKRMarketStatus();
      if (!market.isRegularMarketOpen) {
        this.logger.log(`예약 매수 건너뜀: ${market.message ?? '정규장이 아님'}`);
        return;
      }

      const result = await this.tossApiService.executeApprovedBuys();
      this.logger.log(
        `예약 매수 완료: 체결 ${result.orders.length}건, 건너뜀 ${result.skipped.length}건, 예수금 ${result.cashBuyingPower.toLocaleString()}원`,
      );
    } catch (error) {
      this.logger.error(
        `예약 매수 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 평일 1분마다 손절, 5분마다 위험 공시도 함께 점검
   */
  @Cron('* 9-15 * * 1-5', { timeZone: 'Asia/Seoul' })
  async checkIntradayExits(): Promise<void> {
    try {
      const minute = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Seoul',
          minute: 'numeric',
        }).format(new Date()),
      );
      const result = await this.intradayExit.runTick(minute % 5 === 0);
      if (result.sold.length > 0) {
        this.logger.log(
          `장중 매도 ${result.sold.length}건: ${result.sold.map((item) => `${item.symbol}(${item.trigger})`).join(', ')}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `장중 매도 점검 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 평일 20:00 KST — 당일 매수/매도 리포트 (거래가 있을 때만)
   */
  @Cron('0 20 * * 1-5', { timeZone: 'Asia/Seoul' })
  async sendEveningTradeReport(): Promise<void> {    try {
      const sent = await this.slackService.sendDailyTradeReport();
      this.logger.log(sent ? '당일 매매 리포트 전송 완료' : '당일 매매 없음, 리포트 생략');
    } catch (error) {
      this.logger.error(
        `매매 리포트 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

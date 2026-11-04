import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, LogLevel } from '@slack/bolt';
import { PrismaService } from '../prisma/prisma.service.js';
import { TossApiService } from '../toss-api/toss-api.service.js';
import type {
  ApprovalResult,
  BuyRecommendation,
  SellNotice,
} from './interfaces/slack.interface.js';
import type { StockAnalysisResult } from '../llm/interfaces/llm.interface.js';

@Injectable()
export class SlackService implements OnModuleInit {
  private readonly logger = new Logger(SlackService.name);
  private app: App;
  private readonly defaultChannel: string;
  private openHoursBuyTimer: ReturnType<typeof setTimeout> | null = null;
  private executingApprovedBuys = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tossApiService: TossApiService,
  ) {
    const botToken = this.configService.getOrThrow<string>('SLACK_BOT_TOKEN');
    const appToken = this.configService.getOrThrow<string>('SLACK_APP_TOKEN');
    this.defaultChannel = this.configService.getOrThrow<string>('SLACK_CHANNEL_ID');

    // Slack App 초기화 (Socket Mode)
    this.app = new App({
      token: botToken,
      appToken: appToken,
      socketMode: true,
      logLevel: this.configService.get<string>('NODE_ENV') === 'production' 
        ? LogLevel.ERROR 
        : LogLevel.INFO,
    });

    this.registerEventHandlers();
  }

  /**
   * NestJS 모듈 초기화 시 Slack App 시작
   */
  async onModuleInit() {
    try {
      await this.app.start();
      this.logger.log('⚡️ Slack Bolt app is running (Socket Mode)');
    } catch (error) {
      this.logger.error('Failed to start Slack Bolt app', error);
      throw error;
    }
  }

  /**
   * Slack Interactive Button 이벤트 핸들러 등록
   */
  private registerEventHandlers() {
    // [매수 승인] 버튼 클릭 이벤트
    this.app.action(
      'approve_buy',
      async ({ ack, body, client }) => {
        await ack(); // 3초 내에 응답 필수

        const action = (body as any).actions[0];
        const strategyLogId = parseInt(action.value, 10);
        const userId = (body as any).user.id;
        const channelId = (body as any).channel?.id;
        const messageTs = (body as any).message?.ts;

        this.logger.log(
          `✅ [매수 승인] 버튼 클릭: strategyLogId=${strategyLogId}, user=${(body as any).user.username}`,
        );

        try {
          // 1. StrategyLog 조회
          const strategyLog = await this.prisma.strategyLog.findUnique({
            where: { id: strategyLogId },
          });

          if (!strategyLog) {
            throw new Error(`StrategyLog ID ${strategyLogId}를 찾을 수 없습니다.`);
          }

          if (strategyLog.isApproved) {
            // 이미 승인된 경우
            await this.updateSlackMessage(
              client,
              channelId!,
              messageTs!,
              `⚠️ 이미 승인된 주문입니다. (종목: ${strategyLog.symbol})`,
              'warning',
            );
            return;
          }

          const market = await this.tossApiService.getKRMarketStatus();
          const buyNow = Boolean(market.isRegularMarketOpen);
          const regularStart = market.regularMarket?.start;
          const beforeOpen =
            !buyNow &&
            Boolean(regularStart) &&
            Date.now() < new Date(regularStart).getTime();

          if (!buyNow && !beforeOpen) {
            await this.updateSlackMessage(
              client,
              channelId!,
              messageTs!,
              `🚫 *장 마감 뒤에는 매수 결재를 할 수 없습니다.*\n\n다음 날 자정 이후 새로 오는 추천을 기다려 주세요.`,
              'cancelled',
            );
            return;
          }

          await this.prisma.strategyLog.update({
            where: { id: strategyLogId },
            data: { isApproved: true },
          });

          this.logger.log(
            `✅ 매수 결재 완료: strategyLogId=${strategyLogId}, symbol=${strategyLog.symbol}, buyNow=${buyNow}`,
          );

          if (buyNow) {
            this.scheduleOpenHoursBuy();
          }

          await this.updateSlackMessage(
            client,
            channelId!,
            messageTs!,
            `✅ *매수 결재가 완료되었습니다.*\n\n` +
              `• 종목: ${strategyLog.symbol}\n` +
              `• 승인자: <@${userId}>\n\n` +
              (buyNow
                ? `정규장이 열려 있어 다른 승인과 묶어 예수금을 나눈 뒤 바로 시장가 매수합니다.`
                : `오늘 09:00에 매수가능금액을 당일 승인 종목 수만큼 나눠 시장가 매수합니다.`),
            'success',
          );
        } catch (error) {
          this.logger.error(`매수 승인 처리 실패: ${error}`);

          // 에러 로깅
          await this.prisma.errorLog.create({
            data: {
              module: 'SlackService',
              errorCode: 'APPROVE_BUY_FAILED',
              message: `매수 승인 처리 실패: ${error instanceof Error ? error.message : String(error)}`,
            },
          });

          // 에러 메시지로 업데이트
          await this.updateSlackMessage(
            client,
            channelId!,
            messageTs!,
            `❌ 매수 주문 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
            'error',
          );
        }
      },
    );

    // [거절] 버튼 클릭 이벤트
    this.app.action(
      'reject_buy',
      async ({ ack, body, client }) => {
        await ack();

        const action = (body as any).actions[0];
        const strategyLogId = parseInt(action.value, 10);
        const userId = (body as any).user.id;
        const channelId = (body as any).channel?.id;
        const messageTs = (body as any).message?.ts;

        this.logger.log(
          `❌ [거절] 버튼 클릭: strategyLogId=${strategyLogId}, user=${(body as any).user.username}`,
        );

        try {
          // StrategyLog decision을 'REJECTED'로 업데이트
          await this.prisma.strategyLog.update({
            where: { id: strategyLogId },
            data: { 
              isApproved: false,
              decision: 'REJECTED', // 거절 상태로 변경
            },
          });

          // Slack 메시지 업데이트
          await this.updateSlackMessage(
            client,
            channelId!,
            messageTs!,
            `❌ *매수가 취소되었습니다.*\n\n거절자: <@${userId}>`,
            'cancelled',
          );
        } catch (error) {
          this.logger.error(`매수 거절 처리 실패: ${error}`);

          await this.updateSlackMessage(
            client,
            channelId!,
            messageTs!,
            `⚠️ 거절 처리 중 오류 발생: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
            'error',
          );
        }
      },
    );

    this.logger.log('✅ Slack 이벤트 핸들러 등록 완료 (approve_buy, reject_buy)');
  }

  /**
   * 정규장 중 승인은 버튼을 연속으로 눌러도 한 번에 배분하도록 잠시 모은다.
   */
  private scheduleOpenHoursBuy(): void {
    if (this.openHoursBuyTimer) {
      clearTimeout(this.openHoursBuyTimer);
    }
    this.openHoursBuyTimer = setTimeout(() => {
      this.openHoursBuyTimer = null;
      void this.flushOpenHoursBuys();
    }, 8_000);
  }

  private async flushOpenHoursBuys(): Promise<void> {
    if (this.executingApprovedBuys) {
      return;
    }
    this.executingApprovedBuys = true;
    try {
      const market = await this.tossApiService.getKRMarketStatus();
      if (!market.isRegularMarketOpen) {
        this.logger.log('정규장이 아니라 즉시 매수를 건너뜁니다.');
        return;
      }
      const result = await this.tossApiService.executeApprovedBuys();
      this.logger.log(
        `정규장 즉시 매수 완료: 체결 ${result.orders.length}건, 건너뜀 ${result.skipped.length}건`,
      );
    } catch (error) {
      this.logger.error(
        `정규장 즉시 매수 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.prisma.errorLog.create({
        data: {
          module: 'SlackService',
          errorCode: 'OPEN_HOURS_BUY_FAILED',
          message: `정규장 즉시 매수 실패: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    } finally {
      this.executingApprovedBuys = false;
    }
  }

  /**
   * 매수 추천 브리핑을 Slack으로 전송
   * @param recommendation 매수 추천 정보
   * @param channelId Slack 채널 ID (기본값: 환경변수 SLACK_CHANNEL_ID)
   * @returns 전송된 메시지의 타임스탬프. 예수금으로 1주도 못 사면 보내지 않고 null
   */
  async sendBuyApprovalMessage(
    recommendation: BuyRecommendation,
    channelId?: string,
  ): Promise<string | null> {
    const channel = channelId || this.defaultChannel;

    const buyingPower = await this.tossApiService.getBuyingPower('KRW');
    const cash = parseFloat(buyingPower.cashBuyingPower);
    if (
      !Number.isFinite(recommendation.currentPrice) ||
      recommendation.currentPrice <= 0 ||
      !Number.isFinite(cash) ||
      cash < recommendation.currentPrice
    ) {
      this.logger.warn(
        `슬랙 매수 알림 생략: ${recommendation.symbol} 현재가 ${recommendation.currentPrice.toLocaleString()}원, 예수금 ${Number.isFinite(cash) ? cash.toLocaleString() : '-'}원`,
      );
      return null;
    }

    try {
      const result = await this.app.client.chat.postMessage({
        channel,
        text: `[매수 추천] ${recommendation.symbol} - ${recommendation.companyName || ''}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `📈 매수 추천: ${recommendation.symbol}`,
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*종목명:*\n${recommendation.companyName || recommendation.symbol}`,
              },
              {
                type: 'mrkdwn',
                text: `*현재가:*\n${recommendation.currentPrice.toLocaleString()}원`,
              },
              {
                type: 'mrkdwn',
                text: `*LLM 점수:*\n${recommendation.llmScore}/10`,
              },
              {
                type: 'mrkdwn',
                text: `*DART 공시:*\n${recommendation.dartId || 'N/A'}`,
              },
            ],
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*🤖 AI 추천 사유:*\n${recommendation.reason}`,
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'actions',
            block_id: `approval_actions_${recommendation.strategyLogId}`,
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: '✅ 매수 승인',
                  emoji: true,
                },
                style: 'primary',
                action_id: 'approve_buy',
                value: String(recommendation.strategyLogId),
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: '❌ 거절',
                  emoji: true,
                },
                style: 'danger',
                action_id: 'reject_buy',
                value: String(recommendation.strategyLogId),
              },
            ],
          },
        ],
      });

      this.logger.log(
        `✅ Slack 메시지 전송 완료: ${recommendation.symbol} (ts: ${result.ts})`,
      );

      return result.ts!;
    } catch (error) {
      this.logger.error(`Slack 메시지 전송 실패: ${error}`);

      await this.prisma.errorLog.create({
        data: {
          module: 'SlackService',
          errorCode: 'SLACK_MESSAGE_FAILED',
          message: `Slack 메시지 전송 실패: ${error instanceof Error ? error.message : String(error)}`,
        },
      });

      throw error;
    }
  }

  /**
   * 자정 이후 관심종목 점수 브리핑
   */
  async sendWatchlistBriefing(results: StockAnalysisResult[]): Promise<void> {
    if (results.length === 0) return;

    const lines = results.map((item) => {
      const name = item.companyName || item.stockCode;
      const price =
        item.currentPrice > 0 ? `${item.currentPrice.toLocaleString()}원` : '-';
      return `• *${name}* (${item.stockCode}) ${item.score}점 ${item.recommendation} / ${price}`;
    });

    await this.app.client.chat.postMessage({
      channel: this.defaultChannel,
      text: '오늘의 관심종목 분석',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '오늘의 관심종목 분석',
            emoji: true,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              `${lines.join('\n')}\n\n` +
              `7점 이상이면서 예수금으로 1주를 살 수 있는 종목만 아래에서 매수 결재를 받습니다. 09:00 전 승인은 장 시작 때, 09:00 이후 승인은 바로 매수합니다. 장 마감 뒤에는 결재할 수 없고 다음 날 추천을 기다리면 됩니다.`,
          },
        },
      ],
    });
  }

  /**
   * 장중 자동 매도 알림. 결재 버튼은 없다.
   */
  async sendSellNotice(notice: SellNotice): Promise<void> {
    const title =
      notice.trigger === 'STOP_LOSS'
        ? '손절 매도'
        : notice.trigger === 'TAKE_PROFIT'
          ? '익절 매도'
          : '위험 공시 매도';
    const name = notice.companyName || notice.symbol;
    const price =
      notice.price > 0 ? `${notice.price.toLocaleString()}원` : '-';

    await this.app.client.chat.postMessage({
      channel: this.defaultChannel,
      text: `${title}: ${name}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: title, emoji: true },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              `• 종목: *${name}* (${notice.symbol})\n` +
              `• 수량: ${notice.quantity}주 @ ${price}\n` +
              `• 사유: ${notice.reason}`,
          },
        },
      ],
    });
  }

  /**
   * 당일 매수/매도 리포트. 거래가 없으면 보내지 않고 false.
   */
  async sendDailyTradeReport(): Promise<boolean> {
    const trades = await this.prisma.tradeHistory.findMany({
      where: { orderedAt: { gte: this.startOfTodayKst() } },
      orderBy: { orderedAt: 'asc' },
    });

    if (trades.length === 0) {
      return false;
    }

    const day = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const buys = trades.filter((item) => item.orderType === 'BUY');
    const sells = trades.filter((item) => item.orderType === 'SELL');
    const formatLine = (item: (typeof trades)[number]) => {
      const time = new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
      }).format(item.filledAt ?? item.orderedAt);
      const price = item.price > 0 ? `${item.price.toLocaleString()}원` : '-';
      return `• ${item.symbol} ${item.quantity}주 @ ${price} (${item.status}, ${time})`;
    };

    const buyBlock =
      buys.length > 0
        ? `*매수 ${buys.length}건*\n${buys.map(formatLine).join('\n')}`
        : '*매수*\n없음';
    const sellBlock =
      sells.length > 0
        ? `*매도 ${sells.length}건*\n${sells.map(formatLine).join('\n')}`
        : '*매도*\n없음';

    await this.app.client.chat.postMessage({
      channel: this.defaultChannel,
      text: `${day} 매매 리포트`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${day} 매매 리포트`,
            emoji: true,
          },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `${buyBlock}\n\n${sellBlock}` },
        },
      ],
    });

    this.logger.log(`당일 매매 리포트 전송: 매수 ${buys.length} / 매도 ${sells.length}`);
    return true;
  }

  private startOfTodayKst(): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return new Date(`${parts}T00:00:00+09:00`);
  }

  /**
   * Slack 메시지 업데이트 (승인/거절 후)
   */
  private async updateSlackMessage(
    client: any,
    channelId: string,
    messageTs: string,
    text: string,
    status: 'success' | 'error' | 'warning' | 'cancelled',
  ) {
    const emoji =
      status === 'success'
        ? '✅'
        : status === 'error'
          ? '❌'
          : status === 'warning'
            ? '⚠️'
            : '🚫';

    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: `${emoji} ${text}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} ${text}`,
          },
        },
      ],
    });
  }

  /**
   * Slack App 인스턴스 반환 (테스트/디버깅용)
   */
  getApp(): App {
    return this.app;
  }
}

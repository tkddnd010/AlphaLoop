import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, LogLevel } from '@slack/bolt';
import { PrismaService } from '../prisma/prisma.service.js';
import { TossApiService } from '../toss-api/toss-api.service.js';
import type {
  ApprovalResult,
  BuyRecommendation,
} from './interfaces/slack.interface.js';

@Injectable()
export class SlackService implements OnModuleInit {
  private readonly logger = new Logger(SlackService.name);
  private app: App;
  private readonly defaultChannel: string;

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

          // 2. StrategyLog isApproved = true로 업데이트
          await this.prisma.strategyLog.update({
            where: { id: strategyLogId },
            data: { isApproved: true },
          });

          // 3. 실제 매수 주문 실행 (TossApiService 호출)
          const orderResult = await this.tossApiService.buyMarket1Share(
            strategyLog.symbol,
          );

          this.logger.log(
            `✅ 매수 주문 완료: ${strategyLog.symbol}, orderId=${orderResult.orderId}`,
          );

          // 4. Slack 메시지 업데이트
          await this.updateSlackMessage(
            client,
            channelId!,
            messageTs!,
            `✅ *매수 주문이 집행되었습니다!*\n\n` +
              `• 종목: ${strategyLog.symbol}\n` +
              `• 주문 ID: ${orderResult.orderId}\n` +
              `• 상태: ${orderResult.status}\n` +
              `• 승인자: <@${userId}>`,
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
   * 매수 추천 브리핑을 Slack으로 전송
   * @param recommendation 매수 추천 정보
   * @param channelId Slack 채널 ID (기본값: 환경변수 SLACK_CHANNEL_ID)
   * @returns 전송된 메시지의 타임스탬프
   */
  async sendBuyApprovalMessage(
    recommendation: BuyRecommendation,
    channelId?: string,
  ): Promise<string> {
    const channel = channelId || this.defaultChannel;

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

      // 에러 로깅
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

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TossApiService } from '../toss-api/toss-api.service.js';
import { SlackService } from '../slack/slack.service.js';
import { DartService } from '../dart/dart.service.js';
import { LLMService } from '../llm/llm.service.js';
import { WatchListService } from '../watchlist/watchlist.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { HoldingStock } from '../toss-api/interfaces/toss-api.interface.js';
import type { DartDisclosure } from '../dart/interfaces/dart.interface.js';
import type { SellTrigger } from '../slack/interfaces/slack.interface.js';

export interface IntradayExitRun {
  stopLossChecked: number;
  filingsChecked: number;
  sold: Array<{
    symbol: string;
    quantity: number;
    trigger: SellTrigger;
    reason: string;
  }>;
  skipped: string[];
}

@Injectable()
export class IntradayExitService {
  private readonly logger = new Logger(IntradayExitService.name);
  private readonly seenRceptNos = new Set<string>();
  private seededToday = '';
  private hasSeededDisclosures = false;
  private readonly selling = new Set<string>();
  private readonly stopLossBreaches = new Map<string, number>();
  private readonly trailingStates = new Map<
    string,
    { peakGainPct: number; givebackTicks: number }
  >();
  private running = false;
  private static readonly STOP_LOSS_CONFIRM_TICKS = 2;

  private static readonly DANGEROUS_TITLE_PATTERNS = [
    '영업정지',
    '상장폐지',
    '감사의견거절',
    '감사의견 거절',
    '횡령',
    '배임',
    '회생절차',
    '파산신청',
    '파산',
    '자본잠식',
    '회계처리기준위반',
    '회계부정',
  ];

  constructor(
    private readonly configService: ConfigService,
    private readonly tossApiService: TossApiService,
    private readonly slackService: SlackService,
    private readonly dartService: DartService,
    private readonly llmService: LLMService,
    private readonly watchlistService: WatchListService,
    private readonly prisma: PrismaService,
  ) {}

  stopLossPercent(): number {
    return this.envPercent('STOP_LOSS_PERCENT', 5);
  }

  takeProfitArmPercent(): number {
    return this.envPercent('TAKE_PROFIT_ARM_PERCENT', 4);
  }

  trailingGivebackPercent(): number {
    return this.envPercent('TRAILING_GIVEBACK_PERCENT', 1);
  }

  private envPercent(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key, String(fallback));
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  async runStopLoss(): Promise<IntradayExitRun> {
    return this.run({ stopLoss: true, filings: false });
  }

  async runDangerousFilings(): Promise<IntradayExitRun> {
    return this.run({ stopLoss: false, filings: true });
  }

  async runAll(): Promise<IntradayExitRun> {
    return this.run({ stopLoss: true, filings: true });
  }

  async runTick(includeFilings: boolean): Promise<IntradayExitRun> {
    return this.run({ stopLoss: true, filings: includeFilings });
  }

  private async run(options: {
    stopLoss: boolean;
    filings: boolean;
  }): Promise<IntradayExitRun> {
    const result: IntradayExitRun = {
      stopLossChecked: 0,
      filingsChecked: 0,
      sold: [],
      skipped: [],
    };

    if (this.running) {
      result.skipped.push('이미 장중 매도 점검이 실행 중');
      return result;
    }

    const market = await this.tossApiService.canPlaceRegularMarketOrder();
    if (!market.ok) {
      result.skipped.push(market.reason ?? '정규장이 아님');
      return result;
    }

    this.running = true;
    try {
      this.resetSeenIfNewKstDay();
      const holdings = await this.watchlistHoldings();
      if (holdings.length === 0) {
        this.logger.log('관심종목 보유가 없어 장중 매도를 건너뜁니다.');
        return result;
      }

      if (options.stopLoss) {
        if (market.inOpeningBuffer) {
          this.stopLossBreaches.clear();
          this.trailingStates.clear();
          result.skipped.push('장 시작 5분은 손절·익절을 건너뜀');
          this.logger.log('장 시작 직후라 손절·익절 점검을 건너뜁니다.');
        } else {
          await this.checkTrailingTakeProfit(holdings, result);
          const stillHeld = holdings.filter(
            (item) => !result.sold.some((sold) => sold.symbol === item.ticker),
          );
          await this.checkStopLoss(stillHeld, result);
        }
      }
      if (options.filings) {
        const stillHeld = await this.watchlistHoldings();
        await this.checkDangerousFilings(stillHeld, result);
      }
      return result;
    } finally {
      this.running = false;
    }
  }

  private async watchlistHoldings(): Promise<HoldingStock[]> {
    const watch = new Set(this.watchlistService.getSymbols());
    const balance = await this.tossApiService.getMyAccountBalanceKROnly();
    return balance.holdings.filter(
      (item) => watch.has(item.ticker) && item.quantity >= 1,
    );
  }

  private async checkTrailingTakeProfit(
    holdings: HoldingStock[],
    result: IntradayExitRun,
  ): Promise<void> {
    const armPct = this.takeProfitArmPercent();
    const givebackPct = this.trailingGivebackPercent();
    if (armPct <= 0 || givebackPct <= 0) {
      result.skipped.push('익절 트레일링 설정이 없어 건너뜀');
      return;
    }

    const held = new Set(holdings.map((item) => item.ticker));
    for (const symbol of this.trailingStates.keys()) {
      if (!held.has(symbol)) {
        this.trailingStates.delete(symbol);
      }
    }

    for (const holding of holdings) {
      if (holding.averagePrice <= 0) {
        continue;
      }

      const gainPct =
        ((holding.currentPrice - holding.averagePrice) / holding.averagePrice) *
        100;
      let state = this.trailingStates.get(holding.ticker);

      if (!state && gainPct + 1e-9 < armPct) {
        continue;
      }

      if (!state) {
        state = { peakGainPct: gainPct, givebackTicks: 0 };
        this.trailingStates.set(holding.ticker, state);
        this.logger.log(
          `${holding.ticker} 익절 트레일링 시작: +${gainPct.toFixed(1)}% (발동 ${armPct}%)`,
        );
      } else if (gainPct > state.peakGainPct) {
        state.peakGainPct = gainPct;
        state.givebackTicks = 0;
      }

      const pullback = state.peakGainPct - gainPct;
      if (pullback + 1e-9 < givebackPct) {
        state.givebackTicks = 0;
        continue;
      }

      state.givebackTicks += 1;
      this.logger.log(
        `${holding.ticker} 익절 되돌림 ${state.givebackTicks}/${IntradayExitService.STOP_LOSS_CONFIRM_TICKS}회: ` +
          `고점 +${state.peakGainPct.toFixed(1)}% → 현재 +${gainPct.toFixed(1)}%`,
      );
      if (state.givebackTicks < IntradayExitService.STOP_LOSS_CONFIRM_TICKS) {
        continue;
      }

      const reason =
        `평균단가 대비 +${state.peakGainPct.toFixed(1)}%까지 오른 뒤 ` +
        `${givebackPct}%p 되돌림 (현재 +${gainPct.toFixed(1)}%)`;
      const sold = await this.sellHolding(holding, 'TAKE_PROFIT', reason, 8);
      this.trailingStates.delete(holding.ticker);
      if (sold) {
        result.sold.push(sold);
      }
    }
  }

  private async checkStopLoss(
    holdings: HoldingStock[],
    result: IntradayExitRun,
  ): Promise<void> {
    const threshold = this.stopLossPercent();
    if (threshold <= 0) {
      result.skipped.push('STOP_LOSS_PERCENT가 없어 손절을 건너뜀');
      return;
    }

    const held = new Set(holdings.map((item) => item.ticker));
    for (const symbol of this.stopLossBreaches.keys()) {
      if (!held.has(symbol)) {
        this.stopLossBreaches.delete(symbol);
      }
    }

    for (const holding of holdings) {
      result.stopLossChecked += 1;
      if (holding.averagePrice <= 0) {
        continue;
      }

      const dropPct =
        ((holding.averagePrice - holding.currentPrice) / holding.averagePrice) *
        100;
      if (dropPct + 1e-9 < threshold) {
        if (this.stopLossBreaches.has(holding.ticker)) {
          this.logger.log(
            `${holding.ticker} 손절 이탈 해제: ${dropPct.toFixed(1)}% (기준 ${threshold}%)`,
          );
        }
        this.stopLossBreaches.delete(holding.ticker);
        continue;
      }

      const ticks = (this.stopLossBreaches.get(holding.ticker) ?? 0) + 1;
      this.stopLossBreaches.set(holding.ticker, ticks);
      this.logger.log(
        `${holding.ticker} 손절 이탈 ${ticks}/${IntradayExitService.STOP_LOSS_CONFIRM_TICKS}회: ` +
          `${dropPct.toFixed(1)}% (기준 ${threshold}%)`,
      );
      if (ticks < IntradayExitService.STOP_LOSS_CONFIRM_TICKS) {
        continue;
      }

      const reason =
        `평균단가 ${holding.averagePrice.toLocaleString()}원 대비 ` +
        `현재가 ${holding.currentPrice.toLocaleString()}원 ` +
        `(${dropPct.toFixed(1)}% 하락, 손절 ${threshold}% ${ticks}분 연속)`;
      const sold = await this.sellHolding(holding, 'STOP_LOSS', reason, 2);
      this.stopLossBreaches.delete(holding.ticker);
      if (sold) {
        result.sold.push(sold);
      }
    }
  }

  private async checkDangerousFilings(
    holdings: HoldingStock[],
    result: IntradayExitRun,
  ): Promise<void> {
    this.resetSeenIfNewKstDay();
    const bySymbol = new Map<string, DartDisclosure[]>();

    for (const holding of holdings) {
      result.filingsChecked += 1;
      try {
        bySymbol.set(
          holding.ticker,
          await this.dartService.getRecentDisclosures(holding.ticker, 0),
        );
      } catch (error) {
        this.logger.warn(
          `${holding.ticker} 당일 공시 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
        bySymbol.set(holding.ticker, []);
      }
    }

    if (!this.hasSeededDisclosures) {
      for (const disclosures of bySymbol.values()) {
        for (const item of disclosures) {
          this.seenRceptNos.add(item.rcept_no);
        }
      }
      this.hasSeededDisclosures = true;
      this.logger.log(
        `당일 기존 공시 ${this.seenRceptNos.size}건은 시드로 건너뜁니다. 이후 신규 공시만 매도합니다.`,
      );
      return;
    }

    for (const holding of holdings) {
      const unseen = (bySymbol.get(holding.ticker) ?? []).filter(
        (item) => !this.seenRceptNos.has(item.rcept_no),
      );

      for (const disclosure of unseen) {
        this.seenRceptNos.add(disclosure.rcept_no);
        if (!this.matchDangerousTitle(disclosure.report_nm)) {
          continue;
        }

        try {
          const summary = await this.dartService.generateDisclosureSummaryAsync([
            disclosure,
          ]);
          const analysis = await this.llmService.analyzeStock({
            stockCode: holding.ticker,
            companyName: holding.name || disclosure.corp_name,
            currentPrice: holding.currentPrice,
            disclosures: summary,
          });
          if (analysis.score > 4) {
            this.logger.log(
              `${holding.ticker} 위험 키워드 공시지만 ${analysis.score}점이라 보유: ${disclosure.report_nm}`,
            );
            continue;
          }

          const reason =
            `위험 키워드 + ${analysis.score}점: ${disclosure.report_nm}. ${analysis.reason}`;
          const sold = await this.sellHolding(
            holding,
            'DANGEROUS_FILING',
            reason,
            analysis.score,
            disclosure.rcept_no,
          );
          if (sold) {
            result.sold.push(sold);
          }
          break;
        } catch (error) {
          this.logger.warn(
            `${holding.ticker} 공시 분석 실패(${disclosure.rcept_no}): ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }

  private matchDangerousTitle(reportName: string): boolean {
    const compact = reportName.replace(/\s+/g, '');
    return IntradayExitService.DANGEROUS_TITLE_PATTERNS.some(
      (pattern) =>
        reportName.includes(pattern) || compact.includes(pattern.replace(/\s+/g, '')),
    );
  }

  private async sellHolding(
    holding: HoldingStock,
    trigger: SellTrigger,
    reason: string,
    llmScore: number,
    dartId?: string,
  ): Promise<IntradayExitRun['sold'][number] | null> {
    const symbol = holding.ticker;
    const quantity = Math.floor(holding.quantity);
    if (quantity < 1 || this.selling.has(symbol)) {
      return null;
    }

    this.selling.add(symbol);
    try {
      const strategyLog = await this.prisma.strategyLog.create({
        data: {
          symbol,
          dartId: dartId ?? null,
          llmScore,
          reason,
          decision: 'SELL',
          isApproved: true,
        },
      });

      const order = await this.tossApiService.sellMarketShares(
        symbol,
        quantity,
        strategyLog.id,
      );
      const fillPrice = Number(order.averageFillPrice ?? holding.currentPrice);

      await this.slackService.sendSellNotice({
        symbol,
        companyName: holding.name,
        quantity,
        price: Number.isFinite(fillPrice) ? fillPrice : holding.currentPrice,
        reason,
        trigger,
      });

      this.logger.log(
        `장중 매도 완료: ${symbol} ${quantity}주 (${trigger}) ${reason}`,
      );
      return { symbol, quantity, trigger, reason };
    } catch (error) {
      this.logger.error(
        `${symbol} 장중 매도 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      this.selling.delete(symbol);
    }
  }

  private resetSeenIfNewKstDay(): void {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (this.seededToday === today) {
      return;
    }
    this.seenRceptNos.clear();
    this.stopLossBreaches.clear();
    this.trailingStates.clear();
    this.seededToday = today;
    this.hasSeededDisclosures = false;
  }
}

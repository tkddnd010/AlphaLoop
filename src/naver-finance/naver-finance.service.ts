import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';
import type {
  DailyCandle,
  TechnicalIndicators,
  TechnicalScore,
} from './interfaces/naver-finance.interface.js';

@Injectable()
export class NaverFinanceService {
  private readonly logger = new Logger(NaverFinanceService.name);

  constructor(private readonly httpService: HttpService) {}

  /**
   * 네이버 금융에서 일봉 데이터 조회 (최근 N일)
   * @param symbol 종목 코드 (6자리)
   * @param days 조회 기간 (기본 60일)
   */
  async getDailyCandles(
    symbol: string,
    days = 60,
  ): Promise<DailyCandle[]> {
    try {
      const candles: DailyCandle[] = [];
      const pageSize = 20; // 페이지당 20개
      const maxPages = Math.ceil(days / pageSize);

      // 여러 페이지 순회 (index는 0부터 시작)
      for (let index = 0; index < maxPages && candles.length < days; index++) {
        const url = `https://stock.naver.com/api/stockSecurity/items/v2/domestic/${symbol}/daily-prices/paged`;

        const { data } = await firstValueFrom(
          this.httpService.get<any>(url, {
            params: {
              size: pageSize,
              index,
            },
            timeout: 10_000,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Accept: 'application/json',
            },
          }),
        );

        // 응답 구조: { hasNext, items: [...] }
        const items = data?.items || [];

        for (const item of items) {
          // 날짜 형식: "2026-11-18"
          const date = item.tradingDateKst || '';

          const close = parseFloat(item.closingPrice) || 0;
          const open = parseFloat(item.openingPrice) || 0;
          const high = parseFloat(item.highPrice) || 0;
          const low = parseFloat(item.lowPrice) || 0;
          const volume = parseFloat(item.tradingVolume) || 0;

          if (close > 0 && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            candles.push({ date, open, high, low, close, volume });
          }
        }

        // 더 이상 데이터가 없으면 중단
        if (items.length < pageSize) break;

        // 페이지 간 요청 간격 (과도한 크롤링 방지)
        if (index < maxPages - 1 && candles.length < days) {
          await this.sleep(100); // 100ms 대기
        }
      }

      this.logger.log(
        `${symbol} 일봉 ${candles.length}개 조회 완료`,
      );

      // 최신순 → 오래된 순으로 정렬
      return candles.reverse();
    } catch (error) {
      this.logger.error(
        `${symbol} 일봉 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * 기술적 지표 계산
   */
  async calculateTechnicalIndicators(
    symbol: string,
    currentPrice: number,
  ): Promise<TechnicalIndicators> {
    const candles = await this.getDailyCandles(symbol, 60);

    if (candles.length < 20) {
      this.logger.warn(
        `${symbol} 데이터 부족 (${candles.length}개), 기술적 지표 계산 불가`,
      );
      return this.emptyIndicators(symbol, currentPrice, candles);
    }

    // 이동평균선
    const ma5 = this.calculateMA(candles, 5);
    const ma20 = this.calculateMA(candles, 20);
    const goldenCross = ma5 !== null && ma20 !== null && ma5 > ma20;

    // 거래량
    const avgVolume = this.calculateAvgVolume(candles, 20);
    const currentVolume = candles[candles.length - 1]?.volume ?? 0;
    const volumeRatio =
      avgVolume !== null && avgVolume > 0 ? currentVolume / avgVolume : null;
    const volumeSurge = volumeRatio !== null && volumeRatio >= 2.0;

    // RSI
    const rsi = this.calculateRSI(candles, 14);
    const rsiOversold = rsi !== null && rsi < 30;

    // 가격 추세
    const priceChange5d = this.getPriceChange(candles, 5, currentPrice);
    const priceChange20d = this.getPriceChange(candles, 20, currentPrice);

    return {
      symbol,
      ma5,
      ma20,
      goldenCross,
      avgVolume,
      volumeRatio,
      volumeSurge,
      rsi,
      rsiOversold,
      priceChange5d,
      priceChange20d,
      currentPrice,
      candles,
    };
  }

  /**
   * 기술적 점수 계산 (0~10점)
   */
  async calculateTechnicalScore(
    symbol: string,
    currentPrice: number,
  ): Promise<TechnicalScore> {
    const indicators = await this.calculateTechnicalIndicators(
      symbol,
      currentPrice,
    );

    let score = 5; // 중립 기준
    const signals: string[] = [];
    const warnings: string[] = [];

    // 1. 골든크로스 (+2점)
    if (indicators.goldenCross) {
      score += 2;
      signals.push('골든크로스 (5일선 > 20일선)');
    } else if (
      indicators.ma5 !== null &&
      indicators.ma20 !== null &&
      indicators.ma5 < indicators.ma20
    ) {
      score -= 1;
      warnings.push('데드크로스 (5일선 < 20일선)');
    }

    // 2. 거래량 급증 (+2점)
    if (indicators.volumeSurge) {
      score += 2;
      signals.push(
        `거래량 급증 (평균 대비 ${indicators.volumeRatio?.toFixed(0)}%)`,
      );
    } else if (
      indicators.volumeRatio !== null &&
      indicators.volumeRatio < 0.5
    ) {
      score -= 1;
      warnings.push('거래량 위축');
    }

    // 3. RSI 과매도 (+1점)
    if (indicators.rsiOversold) {
      score += 1;
      signals.push(`RSI 과매도 (${indicators.rsi?.toFixed(0)})`);
    } else if (indicators.rsi !== null && indicators.rsi > 70) {
      score -= 1;
      warnings.push(`RSI 과매수 (${indicators.rsi.toFixed(0)})`);
    }

    // 4. 단기 상승 추세 (+1점)
    if (indicators.priceChange5d !== null && indicators.priceChange5d > 5) {
      score += 1;
      signals.push(`5일 상승 (+${indicators.priceChange5d.toFixed(1)}%)`);
    } else if (
      indicators.priceChange5d !== null &&
      indicators.priceChange5d < -5
    ) {
      score -= 1;
      warnings.push(`5일 하락 (${indicators.priceChange5d.toFixed(1)}%)`);
    }

    // 점수 범위: 0~10
    score = Math.max(0, Math.min(10, score));

    return {
      symbol,
      score,
      signals,
      warnings,
      indicators,
    };
  }

  // ========================================
  // 지표 계산 헬퍼 메서드
  // ========================================

  /**
   * 이동평균선 계산 (Simple Moving Average)
   */
  private calculateMA(
    candles: DailyCandle[],
    period: number,
  ): number | null {
    if (candles.length < period) return null;

    const recent = candles.slice(-period);
    const sum = recent.reduce((acc, c) => acc + c.close, 0);
    return sum / period;
  }

  /**
   * 평균 거래량 계산
   */
  private calculateAvgVolume(
    candles: DailyCandle[],
    period: number,
  ): number | null {
    if (candles.length < period) return null;

    const recent = candles.slice(-period);
    const sum = recent.reduce((acc, c) => acc + c.volume, 0);
    return sum / period;
  }

  /**
   * RSI 계산 (Relative Strength Index)
   */
  private calculateRSI(
    candles: DailyCandle[],
    period = 14,
  ): number | null {
    if (candles.length < period + 1) return null;

    const changes: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      changes.push(candles[i].close - candles[i - 1].close);
    }

    const recent = changes.slice(-period);
    const gains = recent.filter((c) => c > 0);
    const losses = recent.filter((c) => c < 0).map((c) => Math.abs(c));

    const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;

    if (avgLoss === 0) return 100; // 모든 날이 상승
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  /**
   * N일 전 대비 가격 변화율 (%)
   */
  private getPriceChange(
    candles: DailyCandle[],
    daysAgo: number,
    currentPrice: number,
  ): number | null {
    if (candles.length < daysAgo) return null;

    const pastPrice = candles[candles.length - daysAgo]?.close;
    if (!pastPrice || pastPrice <= 0) return null;

    return ((currentPrice - pastPrice) / pastPrice) * 100;
  }

  /**
   * 데이터 부족 시 빈 지표 반환
   */
  private emptyIndicators(
    symbol: string,
    currentPrice: number,
    candles: DailyCandle[],
  ): TechnicalIndicators {
    return {
      symbol,
      ma5: null,
      ma20: null,
      goldenCross: false,
      avgVolume: null,
      volumeRatio: null,
      volumeSurge: false,
      rsi: null,
      rsiOversold: false,
      priceChange5d: null,
      priceChange20d: null,
      currentPrice,
      candles,
    };
  }

  // ========================================
  // 유틸리티
  // ========================================

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

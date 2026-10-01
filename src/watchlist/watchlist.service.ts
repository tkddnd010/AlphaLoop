import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TossApiService } from '../toss-api/toss-api.service.js';

export interface WatchListStock {
  symbol: string;
  companyName?: string;
  currentPrice?: number;
  isValid: boolean;
  error?: string;
}

@Injectable()
export class WatchListService {
  private readonly logger = new Logger(WatchListService.name);
  private readonly symbols: string[];

  constructor(
    private readonly configService: ConfigService,
    private readonly tossApiService: TossApiService,
  ) {
    // 환경변수에서 관심 종목 리스트 로드
    const symbolsStr = this.configService.get<string>('WATCHLIST_SYMBOLS', '');
    this.symbols = symbolsStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    this.logger.log(`✅ 관심 종목 리스트 로드 완료: ${this.symbols.join(', ')}`);
  }

  /**
   * 관심 종목 리스트 반환
   */
  getSymbols(): string[] {
    return [...this.symbols];
  }

  /**
   * 특정 종목이 관심 종목인지 확인
   */
  isWatchListSymbol(symbol: string): boolean {
    return this.symbols.includes(symbol);
  }

  /**
   * 관심 종목 리스트에 종목 추가
   * (런타임에만 유효, 재시작 시 초기화됨)
   */
  addSymbol(symbol: string): void {
    if (!this.symbols.includes(symbol)) {
      this.symbols.push(symbol);
      this.logger.log(`➕ 관심 종목 추가: ${symbol}`);
    }
  }

  /**
   * 관심 종목 리스트에서 종목 제거
   * (런타임에만 유효, 재시작 시 초기화됨)
   */
  removeSymbol(symbol: string): void {
    const index = this.symbols.indexOf(symbol);
    if (index > -1) {
      this.symbols.splice(index, 1);
      this.logger.log(`➖ 관심 종목 제거: ${symbol}`);
    }
  }

  /**
   * 관심 종목 전체 현재가 조회
   */
  async getAllCurrentPrices(): Promise<WatchListStock[]> {
    const results: WatchListStock[] = [];

    for (const symbol of this.symbols) {
      try {
        const priceInfo = await this.tossApiService.getCurrentPrice(symbol);
        results.push({
          symbol,
          companyName: undefined, // TossAPI에서는 종목명을 제공하지 않음
          currentPrice: priceInfo.currentPrice,
          isValid: true,
        });
      } catch (error) {
        this.logger.warn(`⚠️ ${symbol} 현재가 조회 실패: ${error}`);
        results.push({
          symbol,
          isValid: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * 예수금으로 매수 가능한 종목 필터링
   * @param maxPrice 최대 가격 (예수금)
   */
  async getAffordableSymbols(maxPrice: number): Promise<WatchListStock[]> {
    const allPrices = await this.getAllCurrentPrices();
    
    return allPrices.filter(
      (stock) => stock.isValid && stock.currentPrice && stock.currentPrice <= maxPrice,
    );
  }

  /**
   * 관심 종목 요약 정보
   */
  async getSummary(): Promise<{
    totalSymbols: number;
    symbols: string[];
    prices: WatchListStock[];
    averagePrice: number;
    minPrice: number;
    maxPrice: number;
  }> {
    const prices = await this.getAllCurrentPrices();
    const validPrices = prices
      .filter((p) => p.isValid && p.currentPrice)
      .map((p) => p.currentPrice!);

    return {
      totalSymbols: this.symbols.length,
      symbols: this.symbols,
      prices,
      averagePrice: validPrices.length > 0
        ? Math.round(validPrices.reduce((a, b) => a + b, 0) / validPrices.length)
        : 0,
      minPrice: validPrices.length > 0 ? Math.min(...validPrices) : 0,
      maxPrice: validPrices.length > 0 ? Math.max(...validPrices) : 0,
    };
  }
}

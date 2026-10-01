import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import Bottleneck from 'bottleneck';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AccessTokenResponse,
  AccountBalanceResponse,
  AccountsApiResponse,
  ApiError,
  BuyingPower,
  BuyingPowerApiResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  Currency,
  ErrorResponse,
  OAuth2ErrorResponse,
  Order,
  PriceCheckResult,
  PricesApiResponse,
  TossAccount,
} from './interfaces/toss-api.interface.js';

@Injectable()
export class TossApiService {
  private readonly logger = new Logger(TossApiService.name);
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly accountNumber?: string;
  private readonly accountProductCode: string;

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  // Rate Limiters (TPS 제한)
  private readonly accountLimiter: Bottleneck;
  private readonly stockLimiter: Bottleneck;
  private readonly orderLimiter: Bottleneck;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.baseUrl = this.configService.getOrThrow<string>('TOSS_API_BASE_URL');
    this.clientId = this.configService.getOrThrow<string>('CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>('CLIENT_SECRET');
    this.accountNumber = this.configService.get<string>('ACCOUNT_NUMBER');
    this.accountProductCode = this.configService.get<string>(
      'ACCOUNT_PRODUCT_CODE',
      '01',
    );

    // Rate Limiter 초기화 (토스 공식 문서 기준)
    // ACCOUNT 그룹: 초당 1회
    this.accountLimiter = new Bottleneck({
      minTime: 1000, // 최소 간격 1000ms (1초당 1회)
      maxConcurrent: 1,
    });

    // STOCK 그룹: 초당 5회
    this.stockLimiter = new Bottleneck({
      minTime: 200, // 최소 간격 200ms (1초당 5회)
      maxConcurrent: 1,
    });

    // ORDER 그룹: 초당 10회
    this.orderLimiter = new Bottleneck({
      minTime: 100, // 최소 간격 100ms (1초당 10회)
      maxConcurrent: 1,
    });

    this.logger.log('Rate limiters initialized: ACCOUNT(1 TPS), STOCK(5 TPS), ORDER(10 TPS)');
  }

  /**
   * 지수 백오프 기반 재시도 로직 (HTTP 429, 타임아웃 대응)
   * @param fn 실행할 비동기 함수
   * @param errorMessage 실패 시 에러 메시지
   * @param maxRetries 최대 재시도 횟수 (기본 3회)
   * @returns 함수 실행 결과
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    errorMessage: string,
    maxRetries = 3,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const is429 = status === HttpStatus.TOO_MANY_REQUESTS;
        const isTimeout =
          axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT';

        // 429 또는 타임아웃이 아니면 즉시 에러 throw
        if (!is429 && !isTimeout) {
          // 일반 HTTP 에러 로깅
          const statusCode = status?.toString() || 'UNKNOWN';
          const message = axiosError.response?.data 
            ? JSON.stringify(axiosError.response.data)
            : axiosError.message;
          await this.logError('TossAPI', statusCode, `${errorMessage}: ${message}`);
          throw error;
        }

        // 마지막 재시도인 경우 에러 throw
        if (attempt === maxRetries) {
          this.logger.error(
            `${errorMessage} - 최대 재시도 횟수(${maxRetries}) 도달`,
          );
          // 최대 재시도 실패 로깅
          const statusCode = status?.toString() || (isTimeout ? 'TIMEOUT' : '429');
          await this.logError('TossAPI', statusCode, `${errorMessage} - 최대 재시도 횟수(${maxRetries}) 도달`);
          throw error;
        }

        // 지수 백오프 계산: 1초 -> 2초 -> 4초 (+ jitter)
        const baseDelay = Math.pow(2, attempt - 1) * 1000;
        const jitter = Math.random() * 500; // 0~500ms 랜덤 지터
        const delay = baseDelay + jitter;

        // Retry-After 헤더가 있으면 우선 사용
        const retryAfter = axiosError.response?.headers['retry-after'];
        const finalDelay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : delay;

        this.logger.warn(
          `${errorMessage} - ${is429 ? '429 Rate Limit' : '타임아웃'} 발생, ` +
          `${(finalDelay / 1000).toFixed(1)}초 후 재시도 (${attempt}/${maxRetries})`,
        );

        await this.sleep(finalDelay);
      }
    }

    // 이론적으로 여기 도달하지 않지만 TypeScript를 위해 추가
    throw lastError ?? new Error(errorMessage);
  }

  /**
   * 지정된 밀리초만큼 대기
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 계좌 목록 조회 (GET /api/v1/accounts)
   * - Bearer 토큰만 필요
   * - 응답의 accountSeq 는 이후 API의 X-Tossinvest-Account 헤더에 사용
   * - 현재는 BROKERAGE(종합매매) 계좌만 반환, 없으면 빈 배열
   */
  async getAccounts(): Promise<TossAccount[]> {
    return this.accountLimiter.schedule(async () => {
      return this._getAccountsInternal();
    });
  }

  /**
   * 계좌 목록 조회 내부 메서드 (Rate Limiter 없음)
   * resolveAccountSeq에서 데드락 방지를 위해 사용
   */
  private async _getAccountsInternal(): Promise<TossAccount[]> {
    return this.executeWithRetry(async () => {
      const accessToken = await this.getAccessToken();

      const { data } = await firstValueFrom(
        this.httpService.get<AccountsApiResponse>(
          `${this.baseUrl}/api/v1/accounts`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            timeout: 10_000,
          },
        ),
      );

      return data.result ?? [];
    }, '계좌 목록 조회에 실패했습니다.');
  }

  /**
   * 보유 주식 조회 (GET /api/v1/holdings)
   * X-Tossinvest-Account(accountSeq) 필수
   */
  async getMyAccountBalance(symbol?: string): Promise<AccountBalanceResponse> {
    return this.accountLimiter.schedule(async () => {
      return this.executeWithRetry(async () => {
        const accessToken = await this.getAccessToken();
        const accountSeq = await this.resolveAccountSeq();

        const { data } = await firstValueFrom(
          this.httpService.get<any>(
            `${this.baseUrl}/api/v1/holdings`,
            {
              headers: this.buildAuthHeaders(accessToken, accountSeq),
              params: symbol ? { symbol } : undefined,
              timeout: 10_000,
            },
          ),
        );

        // 토스 API 응답을 우리 인터페이스로 변환
        return this.transformHoldingsResponse(data.result);
      }, '보유 주식 조회에 실패했습니다.');
    });
  }

  /**
   * 보유 주식 조회 - 국내 주식(KR)만 반환
   */
  async getMyAccountBalanceKROnly(): Promise<AccountBalanceResponse> {
    return this.accountLimiter.schedule(async () => {
      return this.executeWithRetry(async () => {
        const accessToken = await this.getAccessToken();
        const accountSeq = await this.resolveAccountSeq();

        const { data } = await firstValueFrom(
          this.httpService.get<any>(
            `${this.baseUrl}/api/v1/holdings`,
            {
              headers: this.buildAuthHeaders(accessToken, accountSeq),
              timeout: 10_000,
            },
          ),
        );

        // 국내 주식(KR)만 필터링
        const krItems = data.result.items.filter(
          (item: any) => item.marketCountry === 'KR',
        );

        const filteredResult = {
          ...data.result,
          items: krItems,
          // KRW 금액만 사용
          totalPurchaseAmount: {
            krw: data.result.totalPurchaseAmount.krw,
            usd: null,
          },
          marketValue: {
            amount: {
              krw: data.result.marketValue.amount.krw,
              usd: null,
            },
            amountAfterCost: {
              krw: data.result.marketValue.amountAfterCost.krw,
              usd: null,
            },
          },
        };

        return this.transformHoldingsResponse(filteredResult);
      }, '보유 주식 조회에 실패했습니다.');
    });
  }

  /**
   * 토스 API HoldingsOverview를 AccountBalanceResponse로 변환
   */
  private transformHoldingsResponse(tossData: any): AccountBalanceResponse {
    return {
      accountNumber: 'N/A', // 토스 API 응답에 없음
      deposit: 0, // holdings API에는 예수금 정보 없음
      totalEvaluationAmount: parseFloat(tossData.marketValue?.amount?.krw ?? '0'),
      totalPurchaseAmount: parseFloat(tossData.totalPurchaseAmount?.krw ?? '0'),
      totalProfitLoss: parseFloat(tossData.profitLoss?.amount?.krw ?? '0'),
      holdings: (tossData.items ?? []).map((item: any) => ({
        ticker: item.symbol,
        name: item.name,
        quantity: parseFloat(item.quantity),
        averagePrice: parseFloat(item.averagePurchasePrice),
        currentPrice: parseFloat(item.lastPrice),
        evaluationAmount: parseFloat(item.marketValue?.amount ?? '0'),
        profitLoss: parseFloat(item.profitLoss?.amount ?? '0'),
        profitLossRate: parseFloat(item.profitLoss?.rate ?? '0'),
      })),
    };
  }

  /**
   * 매수 가능 금액 조회 (GET /api/v1/buying-power)
   * - 미수 거래를 제외한 현금 기반 매수 가능 금액 (cashBuyingPower)
   * - 앱 화면의 '예수금/주문가능현금'에 가장 가까운 공식 API
   */
  async getBuyingPower(currency: Currency = 'KRW'): Promise<BuyingPower> {
    return this.accountLimiter.schedule(async () => {
      return this.executeWithRetry(async () => {
        const accessToken = await this.getAccessToken();
        const accountSeq = await this.resolveAccountSeq();

        const { data } = await firstValueFrom(
          this.httpService.get<BuyingPowerApiResponse>(
            `${this.baseUrl}/api/v1/buying-power`,
            {
              headers: this.buildAuthHeaders(accessToken, accountSeq),
              params: { currency },
              timeout: 10_000,
            },
          ),
        );

        return data.result;
      }, '매수 가능 금액 조회에 실패했습니다.');
    });
  }

  /**
   * 한국 장 운영 시간 조회 (GET /api/v1/market-calendar/KR)
   */
  async getKRMarketStatus() {
    try {
      const accessToken = await this.getAccessToken();

      const { data } = await firstValueFrom(
        this.httpService.get<any>(
          `${this.baseUrl}/api/v1/market-calendar/KR`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            timeout: 10_000,
          },
        ),
      );

      const today = data.result?.today;

      if (!today || !today.integrated) {
        return {
          isOpen: false,
          message: '오늘은 휴장일입니다.',
          date: today?.date ?? null,
          currentTime: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
        };
      }

      const now = new Date();

      // 정규장 시간 체크 (09:00:00 ~ 15:30:00)
      const regularMarket = today.integrated.regularMarket;
      
      if (!regularMarket) {
        return {
          isOpen: false,
          message: '오늘은 정규장이 없습니다.',
          date: today.date,
          currentTime: now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
        };
      }

      const regularStart = new Date(regularMarket.startTime);
      const regularEnd = new Date(regularMarket.endTime);
      const isRegularOpen = now >= regularStart && now <= regularEnd;

      // 장전/장후 시간 체크
      const preMarket = today.integrated.preMarket;
      const afterMarket = today.integrated.afterMarket;

      let marketPhase = '장 마감';
      if (preMarket && now >= new Date(preMarket.startTime) && now < regularStart) {
        marketPhase = '장전 시간외';
      } else if (isRegularOpen) {
        marketPhase = '정규장 운영 중';
      } else if (afterMarket && now >= regularStart && now <= new Date(afterMarket.endTime)) {
        marketPhase = '장후 시간외';
      }

      return {
        isOpen: true,
        isRegularMarketOpen: isRegularOpen,
        marketPhase,
        message: isRegularOpen
          ? '정규장 운영 중 (주문 가능)'
          : `${marketPhase} (${isRegularOpen ? '주문 가능' : '주문 제한'})`,
        date: today.date,
        regularMarket: {
          start: regularMarket.startTime,
          end: regularMarket.endTime,
        },
        currentTime: now.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
      };
    } catch (error) {
      throw this.handleApiError(error, '장 운영 시간 조회에 실패했습니다.');
    }
  }

  /**
   * 특정 종목의 현재가를 조회합니다. (토스 공식 API 사용)
   * @param symbol 종목 코드 (예: '005930' 또는 'AAPL')
   * @returns 현재가 정보
   */
  async getCurrentPrice(symbol: string): Promise<PriceCheckResult> {
    return this.stockLimiter.schedule(async () => {
      return this.executeWithRetry(async () => {
        const accessToken = await this.getAccessToken();

        const { data } = await firstValueFrom(
          this.httpService.get<PricesApiResponse>(
            `${this.baseUrl}/api/v1/prices`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
              params: { symbols: symbol },
              timeout: 10_000,
            },
          ),
        );

        if (!data.result || data.result.length === 0) {
          throw new HttpException(
            {
              statusCode: HttpStatus.NOT_FOUND,
              message: `종목(${symbol})을 찾을 수 없습니다.`,
            },
            HttpStatus.NOT_FOUND,
          );
        }

        const priceData = data.result[0];
        const currentPrice = parseFloat(priceData.lastPrice);

        this.logger.log(
          `종목 ${symbol} 현재가: ${currentPrice.toLocaleString()} ${priceData.currency}`,
        );

        return {
          symbol: priceData.symbol,
          currentPrice,
          currency: priceData.currency,
          isUnder30000: false, // 더 이상 사용하지 않음
          timestamp: priceData.timestamp,
        };
      }, `종목(${symbol}) 현재가 조회에 실패했습니다.`);
    });
  }

  /**
   * 매수 전 예수금 확인 (1주 구매 가능 여부)
   * @param symbol 종목 코드
   * @returns 구매 가능 여부 및 현재가, 예수금 정보
   */
  private async validateBuyingPower(symbol: string): Promise<{
    canBuy: boolean;
    currentPrice: number;
    availableCash: number;
    shortfall: number;
  }> {
    const [priceInfo, buyingPower] = await Promise.all([
      this.getCurrentPrice(symbol),
      this.getBuyingPower('KRW'),
    ]);

    const currentPrice = priceInfo.currentPrice;
    const availableCash = parseFloat(buyingPower.cashBuyingPower);
    const canBuy = availableCash >= currentPrice;
    const shortfall = canBuy ? 0 : currentPrice - availableCash;

    if (!canBuy) {
      this.logger.warn(
        `❌ 예수금 부족: ${symbol} 현재가 ${currentPrice.toLocaleString()}원 > ` +
        `예수금 ${availableCash.toLocaleString()}원 (부족: ${shortfall.toLocaleString()}원)`,
      );
    } else {
      this.logger.log(
        `✅ 예수금 충분: ${symbol} 현재가 ${currentPrice.toLocaleString()}원 <= ` +
        `예수금 ${availableCash.toLocaleString()}원`,
      );
    }

    return { canBuy, currentPrice, availableCash, shortfall };
  }

  /**
   * 주문 생성 (매수/매도)
   * @param request 주문 생성 요청 파라미터
   * @returns 생성된 주문 정보
   */
  async createOrder(request: CreateOrderRequest): Promise<Order> {
    return this.orderLimiter.schedule(async () => {
      return this.executeWithRetry(async () => {
        const accessToken = await this.getAccessToken();
        const accountSeq = await this.resolveAccountSeq();

        this.logger.log(
          `주문 생성 요청: ${request.orderSide} ${request.quantity ?? request.orderAmount} ${request.symbol} @ ${request.orderPrice ?? 'MARKET'}`,
        );

        const { data } = await firstValueFrom(
          this.httpService.post<CreateOrderResponse>(
            `${this.baseUrl}/api/v1/orders`,
            request,
            {
              headers: this.buildAuthHeaders(accessToken, accountSeq),
              timeout: 15_000, // 주문은 타임아웃을 조금 더 길게
            },
          ),
        );

        this.logger.log(
          `주문 생성 성공: orderId=${data.result.orderId}, status=${data.result.status}`,
        );

        // 거래 내역을 데이터베이스에 저장
        await this.logTrade(data.result, request);

        return data.result;
      }, `주문 생성에 실패했습니다: ${request.orderSide} ${request.symbol}`);
    });
  }

  /**
   * 1주 시장가 매수 (예수금 확인 포함)
   * @param symbol 종목 코드
   * @returns 주문 정보
   */
  async buyMarket1Share(symbol: string): Promise<Order> {
    // 예수금 확인
    const validation = await this.validateBuyingPower(symbol);
    
    if (!validation.canBuy) {
      const errorMessage = `예수금이 부족하여 ${symbol} 1주를 매수할 수 없습니다. (현재가: ${validation.currentPrice}원, 예수금: ${validation.availableCash}원, 부족액: ${validation.shortfall}원)`;
      
      // 에러 로그 저장
      await this.logError('TossAPI', '422', errorMessage);
      
      throw new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          message: `예수금이 부족하여 ${symbol} 1주를 매수할 수 없습니다.`,
          detail: {
            symbol,
            currentPrice: validation.currentPrice,
            availableCash: validation.availableCash,
            shortfall: validation.shortfall,
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return this.createOrder({
      symbol,
      orderSide: 'BUY',
      orderType: 'MARKET',
      quantity: '1',
    });
  }

  /**
   * 1주 시장가 매도
   * @param symbol 종목 코드
   * @returns 주문 정보
   */
  async sellMarket1Share(symbol: string): Promise<Order> {
    return this.createOrder({
      symbol,
      orderSide: 'SELL',
      orderType: 'MARKET',
      quantity: '1',
    });
  }

  /**
   * 1주 지정가 매수 (예수금 확인 포함)
   * @param symbol 종목 코드
   * @param price 주문 가격
   * @returns 주문 정보
   */
  async buyLimit1Share(symbol: string, price: string): Promise<Order> {
    // 지정가로 예수금 확인 (지정가 기준)
    const buyingPower = await this.getBuyingPower('KRW');
    const availableCash = parseFloat(buyingPower.cashBuyingPower);
    const limitPrice = parseFloat(price);

    if (availableCash < limitPrice) {
      const shortfall = limitPrice - availableCash;
      this.logger.warn(
        `❌ 예수금 부족: ${symbol} 지정가 ${limitPrice.toLocaleString()}원 > ` +
        `예수금 ${availableCash.toLocaleString()}원 (부족: ${shortfall.toLocaleString()}원)`,
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          message: `예수금이 부족하여 ${symbol} 1주를 ${limitPrice.toLocaleString()}원에 매수할 수 없습니다.`,
          detail: {
            symbol,
            limitPrice,
            availableCash,
            shortfall,
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    this.logger.log(
      `✅ 예수금 충분: ${symbol} 지정가 ${limitPrice.toLocaleString()}원 <= ` +
      `예수금 ${availableCash.toLocaleString()}원`,
    );

    return this.createOrder({
      symbol,
      orderSide: 'BUY',
      orderType: 'LIMIT',
      quantity: '1',
      orderPrice: price,
    });
  }

  /**
   * 1주 지정가 매도
   * @param symbol 종목 코드
   * @param price 주문 가격
   * @returns 주문 정보
   */
  async sellLimit1Share(symbol: string, price: string): Promise<Order> {
    return this.createOrder({
      symbol,
      orderSide: 'SELL',
      orderType: 'LIMIT',
      quantity: '1',
      orderPrice: price,
    });
  }

  /**
   * 계좌 목록에서 사용할 accountSeq 를 고릅니다.
   * ACCOUNT_NUMBER 가 있으면 해당 계좌를, 없으면 첫 번째 BROKERAGE 계좌를 사용합니다.
   * Rate Limiter 데드락 방지를 위해 내부적으로 직접 API 호출
   */
  private async resolveAccountSeq(): Promise<number> {
    // Rate Limiter 우회 (데드락 방지)
    const accounts = await this._getAccountsInternal();

    if (accounts.length === 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.NOT_FOUND,
          message: '조회 가능한 종합매매(BROKERAGE) 계좌가 없습니다.',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    if (this.accountNumber) {
      const matched = accounts.find(
        (account) => account.accountNo === this.accountNumber,
      );
      if (!matched) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `ACCOUNT_NUMBER(${this.accountNumber})에 해당하는하는 계좌를 찾을 수 없습니다.`,
          },
          HttpStatus.NOT_FOUND,
        );
      }
      return matched.accountSeq;
    }

    return accounts[0].accountSeq;
  }

  /**
   * OAuth 2.0 Client Credentials Grant로 액세스 토큰을 발급·캐시합니다.
   * @see POST /oauth2/token (application/x-www-form-urlencoded)
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      });

      const { data } = await firstValueFrom(
        this.httpService.post<AccessTokenResponse>(
          `${this.baseUrl}/oauth2/token`,
          body.toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 10_000,
          },
        ),
      );

      this.cachedToken = data.access_token;
      // 만료 60초 전에 재발급하도록 버퍼를 둡니다.
      this.tokenExpiresAt = now + (data.expires_in - 60) * 1000;
      return this.cachedToken;
    } catch (error) {
      throw this.handleApiError(error, '액세스 토큰 발급에 실패했습니다.', true);
    }
  }

  private buildAuthHeaders(accessToken: string, accountSeq: number): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Tossinvest-Account': String(accountSeq),
    };
  }

  /**
   * 토스 OpenAPI 에러를 Nest HttpException으로 변환합니다.
   * - /oauth2/token: OAuth2ErrorResponse (`error` 문자열로 식별)
   * - 그 외 API: BFF ErrorResponse (`error.code` / `error.message`)
   */
  private handleApiError(
    error: unknown,
    fallbackMessage: string,
    isOAuthEndpoint = false,
  ): never {
    if (error instanceof HttpException) {
      throw error;
    }

    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const responseData = error.response?.data as unknown;
      const rateLimitHeaders = this.extractRateLimitHeaders(error);

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        this.logger.error(`${fallbackMessage} timeout=${error.code}`);
        throw new HttpException(
          {
            statusCode: HttpStatus.GATEWAY_TIMEOUT,
            message: '외부 API 요청이 타임아웃되었습니다.',
            detail: error.message,
          },
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }

      const oauthError = this.asOAuth2Error(responseData);
      const apiError = this.asApiError(responseData);

      // OAuth2 토큰 엔드포인트: error 필드로 식별 (code 아님)
      if (isOAuthEndpoint || oauthError) {
        const detail = {
          error: oauthError?.error,
          error_description: oauthError?.error_description,
          error_uri: oauthError?.error_uri,
        };

        this.logger.error(
          `${fallbackMessage} status=${status ?? 'N/A'} oauthError=${oauthError?.error ?? 'N/A'} description=${oauthError?.error_description ?? ''}`,
        );

        if (status === HttpStatus.BAD_REQUEST) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message:
                '토큰 발급 요청이 올바르지 않습니다. grant_type 또는 필수 파라미터를 확인하세요.',
              ...detail,
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        if (status === HttpStatus.UNAUTHORIZED) {
          this.clearTokenCache();
          throw new HttpException(
            {
              statusCode: HttpStatus.UNAUTHORIZED,
              message:
                '클라이언트 인증에 실패했습니다. client_id / client_secret 또는 클라이언트 상태를 확인하세요.',
              ...detail,
            },
            HttpStatus.UNAUTHORIZED,
          );
        }

        if (status === HttpStatus.FORBIDDEN) {
          throw new HttpException(
            {
              statusCode: HttpStatus.FORBIDDEN,
              message:
                '허용되지 않은 IP에서의 요청입니다. 토스증권 WTS > Open API > 허용 IP 관리에 IP를 등록하세요.',
              ...detail,
            },
            HttpStatus.FORBIDDEN,
          );
        }

        throw new HttpException(
          {
            statusCode: status ?? HttpStatus.BAD_GATEWAY,
            message: fallbackMessage,
            ...detail,
          },
          status ?? HttpStatus.BAD_GATEWAY,
        );
      }

      // 일반 API: BFF ErrorResponse
      const detail = apiError
        ? {
            requestId: apiError.requestId,
            code: apiError.code,
            message: apiError.message,
            data: apiError.data,
          }
        : { message: error.message };

      this.logger.error(
        `${fallbackMessage} status=${status ?? 'N/A'} code=${apiError?.code ?? 'N/A'} requestId=${apiError?.requestId ?? 'N/A'} message=${apiError?.message ?? error.message}`,
      );

      if (status === HttpStatus.UNAUTHORIZED) {
        this.clearTokenCache();
        throw new HttpException(
          {
            statusCode: HttpStatus.UNAUTHORIZED,
            ...detail,
            message:
              apiError?.message ??
              '인증에 실패했습니다. 액세스 토큰을 확인하세요.',
          },
          HttpStatus.UNAUTHORIZED,
        );
      }

      if (status === HttpStatus.FORBIDDEN) {
        throw new HttpException(
          {
            statusCode: HttpStatus.FORBIDDEN,
            ...detail,
            message:
              apiError?.message ??
              '해당 API에 대한 접근 권한이 없습니다.',
          },
          HttpStatus.FORBIDDEN,
        );
      }

      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            ...detail,
            message:
              apiError?.message ??
              '요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.',
            rateLimit: rateLimitHeaders,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      throw new HttpException(
        {
          statusCode: status ?? HttpStatus.BAD_GATEWAY,
          ...detail,
          message: apiError?.message ?? fallbackMessage,
        },
        status ?? HttpStatus.BAD_GATEWAY,
      );
    }

    this.logger.error(`${fallbackMessage}`, error);
    throw new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: fallbackMessage,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private clearTokenCache(): void {
    this.cachedToken = null;
    this.tokenExpiresAt = 0;
  }

  /** OAuth2: error 가 문자열인 경우 */
  private asOAuth2Error(data: unknown): OAuth2ErrorResponse | null {
    if (!data || typeof data !== 'object') {
      return null;
    }
    const maybe = data as Record<string, unknown>;
    if (typeof maybe.error === 'string') {
      return {
        error: maybe.error,
        error_description:
          typeof maybe.error_description === 'string'
            ? maybe.error_description
            : undefined,
        error_uri:
          typeof maybe.error_uri === 'string' ? maybe.error_uri : undefined,
      };
    }
    return null;
  }

  /** BFF: error 가 객체인 경우 */
  private asApiError(data: unknown): ApiError | null {
    if (!data || typeof data !== 'object') {
      return null;
    }
    const maybe = data as Partial<ErrorResponse>;
    const err = maybe.error;
    if (!err || typeof err !== 'object' || Array.isArray(err)) {
      return null;
    }
    if (
      typeof err.requestId === 'string' &&
      typeof err.code === 'string' &&
      typeof err.message === 'string'
    ) {
      return {
        requestId: err.requestId,
        code: err.code,
        message: err.message,
        data: err.data,
      };
    }
    return null;
  }

  private extractRateLimitHeaders(
    error: AxiosError,
  ): Record<string, string | undefined> {
    const headers = error.response?.headers;
    if (!headers) {
      return {};
    }
    return {
      'x-ratelimit-limit': headers['x-ratelimit-limit'] as string | undefined,
      'x-ratelimit-remaining': headers['x-ratelimit-remaining'] as
        | string
        | undefined,
      'x-ratelimit-reset': headers['x-ratelimit-reset'] as string | undefined,
      'retry-after': headers['retry-after'] as string | undefined,
    };
  }

  // ========================================
  // 데이터베이스 로깅 메서드
  // ========================================

  /**
   * 거래 내역을 TradeHistory 테이블에 기록
   * @param order 주문 정보
   * @param request 주문 요청 정보
   */
  private async logTrade(order: Order, request: CreateOrderRequest): Promise<void> {
    try {
      await this.prisma.tradeHistory.create({
        data: {
          symbol: request.symbol,
          orderType: request.orderSide, // BUY or SELL
          price: order.orderPrice ? parseInt(order.orderPrice, 10) : 0,
          quantity: order.quantity ? parseInt(order.quantity, 10) : 1,
          status: order.status, // COMPLETED, PENDING, REJECTED 등
        },
      });
      this.logger.log(`✅ TradeHistory 저장 완료: ${request.orderSide} ${request.symbol}`);
    } catch (error) {
      // 로깅 실패는 주문 자체에 영향을 주지 않도록 에러를 삼킴
      this.logger.error(`❌ TradeHistory 저장 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 에러를 ErrorLog 테이블에 기록
   * @param module 에러 발생 모듈 (예: "TossAPI", "DART", "LLM")
   * @param errorCode HTTP 상태 코드 또는 에러 코드
   * @param message 에러 메시지
   */
  private async logError(module: string, errorCode: string, message: string): Promise<void> {
    try {
      await this.prisma.errorLog.create({
        data: {
          module,
          errorCode,
          message,
        },
      });
      this.logger.log(`✅ ErrorLog 저장 완료: [${module}] ${errorCode}`);
    } catch (error) {
      // 에러 로깅 실패는 조용히 무시
      this.logger.error(`❌ ErrorLog 저장 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

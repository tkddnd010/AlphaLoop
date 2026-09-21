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
import type {
  AccessTokenResponse,
  AccountBalanceResponse,
  AccountsApiResponse,
  ApiError,
  CurrentPriceResponse,
  ErrorResponse,
  OAuth2ErrorResponse,
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

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.getOrThrow<string>('TOSS_API_BASE_URL');
    this.clientId = this.configService.getOrThrow<string>('CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>('CLIENT_SECRET');
    this.accountNumber = this.configService.get<string>('ACCOUNT_NUMBER');
    this.accountProductCode = this.configService.get<string>(
      'ACCOUNT_PRODUCT_CODE',
      '01',
    );
  }

  /**
   * 계좌 목록 조회 (GET /api/v1/accounts)
   * - Bearer 토큰만 필요
   * - 응답의 accountSeq 는 이후 API의 X-Tossinvest-Account 헤더에 사용
   * - 현재는 BROKERAGE(종합매매) 계좌만 반환, 없으면 빈 배열
   */
  async getAccounts(): Promise<TossAccount[]> {
    try {
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
    } catch (error) {
      throw this.handleApiError(error, '계좌 목록 조회에 실패했습니다.');
    }
  }

  /**
   * 보유 주식 조회 (GET /api/v1/holdings)
   * X-Tossinvest-Account(accountSeq) 필수
   */
  async getMyAccountBalance(symbol?: string): Promise<AccountBalanceResponse> {
    try {
      const accessToken = await this.getAccessToken();
      const accountSeq = await this.resolveAccountSeq();

      const { data } = await firstValueFrom(
        this.httpService.get<AccountBalanceResponse>(
          `${this.baseUrl}/api/v1/holdings`,
          {
            headers: this.buildAuthHeaders(accessToken, accountSeq),
            params: symbol ? { symbol } : undefined,
            timeout: 10_000,
          },
        ),
      );

      return data;
    } catch (error) {
      throw this.handleApiError(error, '보유 주식 조회에 실패했습니다.');
    }
  }

  /**
   * 특정 종목의 현재가를 조회합니다.
   * @param ticker 종목 코드 (예: '005930')
   */
  async getCurrentPrice(ticker: string): Promise<CurrentPriceResponse> {
    try {
      const accessToken = await this.getAccessToken();
      const accountSeq = await this.resolveAccountSeq();

      const { data } = await firstValueFrom(
        this.httpService.get<CurrentPriceResponse>(
          `${this.baseUrl}/api/v1/market/stocks/${ticker}/quote`,
          {
            headers: this.buildAuthHeaders(accessToken, accountSeq),
            timeout: 10_000,
          },
        ),
      );

      return data;
    } catch (error) {
      throw this.handleApiError(
        error,
        `종목(${ticker}) 현재가 조회에 실패했습니다.`,
      );
    }
  }

  /**
   * 계좌 목록에서 사용할 accountSeq 를 고릅니다.
   * ACCOUNT_NUMBER 가 있으면 해당 계좌를, 없으면 첫 번째 BROKERAGE 계좌를 사용합니다.
   */
  private async resolveAccountSeq(): Promise<number> {
    const accounts = await this.getAccounts();

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
}

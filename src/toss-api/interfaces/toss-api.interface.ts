/** 계좌 유형 (현재 OpenAPI는 BROKERAGE만 반환) */
export type AccountType =
  | 'BROKERAGE'
  | 'OVERSEAS_DERIVATIVES'
  | 'PENSION_SAVINGS'
  | 'RESHORING_INVESTMENT';

/** GET /api/v1/accounts 의 계좌 한 건 */
export interface TossAccount {
  accountNo: string;
  accountSeq: number;
  accountType: AccountType;
}

/** GET /api/v1/accounts 성공 응답 */
export interface AccountsApiResponse {
  result: TossAccount[];
}

/** 통화 코드 (매수가능금액 등) */
export type Currency = 'KRW' | 'USD';

/** GET /api/v1/buying-power 의 result */
export interface BuyingPower {
  currency: Currency;
  /** 현금 기반 매수 가능 금액 (미수 미발생 기준). KRW는 정수 문자열, USD는 소수 가능 */
  cashBuyingPower: string;
}

/** GET /api/v1/buying-power 성공 응답 */
export interface BuyingPowerApiResponse {
  result: BuyingPower;
}

/** 보유 종목 한 건 */
export interface HoldingStock {
  ticker: string;
  name: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  evaluationAmount: number;
  profitLoss: number;
  profitLossRate: number;
}

/** 계좌 잔고 / 보유 종목 조회 응답 */
export interface AccountBalanceResponse {
  accountNumber: string;
  deposit: number;
  totalEvaluationAmount: number;
  totalPurchaseAmount: number;
  totalProfitLoss: number;
  holdings: HoldingStock[];
}

/** 종목 현재가 조회 응답 */
export interface CurrentPriceResponse {
  ticker: string;
  name: string;
  currentPrice: number;
  change: number;
  changeRate: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  previousClose: number;
  timestamp: string;
}

/** 토큰 발급 성공 응답 (OAuth2 표준) */
export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/** /oauth2/token 에러 코드 */
export type OAuth2ErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'access_denied';

/**
 * /oauth2/token 전용 에러 응답 (OAuth2 표준).
 * code 필드가 아니라 error 필드로 식별합니다.
 */
export interface OAuth2ErrorResponse {
  error: OAuth2ErrorCode | string;
  error_description?: string;
  error_uri?: string;
}

/** 일반 API(BFF) 에러 객체 */
export interface ApiError {
  requestId: string;
  code: string;
  message: string;
  data?: unknown;
}

/**
 * 일반 API 4xx/5xx 에러 응답 (BFF 공통 ErrorResponse).
 * 성공 응답의 ApiResponse 와는 별도 스키마입니다.
 */
export interface ErrorResponse {
  error: ApiError;
}

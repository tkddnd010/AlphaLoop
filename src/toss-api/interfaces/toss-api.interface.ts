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

/** GET /api/v1/prices - 토스 API 공식 현재가 응답 */
export interface PriceResponse {
  symbol: string;
  timestamp: string;
  lastPrice: string;
  currency: Currency;
}

/** GET /api/v1/prices 성공 응답 (배열) */
export interface PricesApiResponse {
  result: PriceResponse[];
}

/** 현재가 조회 및 가격 필터링 결과 */
export interface PriceCheckResult {
  symbol: string;
  currentPrice: number;
  currency: string;
  isUnder30000: boolean;
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

/** 주문 방향 (매수/매도) */
export type OrderSide = 'BUY' | 'SELL';

/** 호가 유형 */
export type OrderType = 'LIMIT' | 'MARKET';

/** 주문 유효 조건 */
export type TimeInForce = 'DAY' | 'CLS';

/** 주문 생성 요청 */
export interface CreateOrderRequest {
  symbol: string;
  orderSide: OrderSide;
  orderType: OrderType;
  quantity?: string;
  orderAmount?: string;
  orderPrice?: string;
  timeInForce?: TimeInForce;
  clientOrderId?: string;
  confirmHighValueOrder?: boolean;
  /** 우리 DB StrategyLog 연결용. 토스 API로는 보내지 않음 */
  strategyId?: number;
}

/** 주문 상태 */
export type OrderStatus =
  | 'PENDING'
  | 'PARTIAL_FILLED'
  | 'FILLED'
  | 'PENDING_CANCEL'
  | 'CANCELED'
  | 'PENDING_REPLACE'
  | 'REPLACED'
  | 'REJECTED'
  | 'CANCEL_REJECTED'
  | 'REPLACE_REJECTED';

/** 주문 정보 (내부 정규화) */
export interface Order {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  orderSide: OrderSide;
  orderType: OrderType;
  quantity: string;
  orderPrice?: string;
  filledQuantity: string;
  averageFillPrice?: string;
  status: OrderStatus;
  orderedAt: string;
  currency: Currency;
}

/** POST /api/v1/orders 직후 응답. 체결 상세는 아직 없을 수 있다 */
export interface CreateOrderResult {
  orderId: string;
  clientOrderId?: string | null;
}

export interface CreateOrderResponse {
  result: CreateOrderResult;
}

/** GET /api/v1/orders/{orderId} 의 체결 정보 */
export interface TossOrderExecution {
  filledQuantity: string;
  averageFilledPrice: string;
  filledAmount: string;
  commission: string;
  tax: string;
  filledAt: string;
  settlementDate: string;
}

/** GET /api/v1/orders/{orderId} 의 result */
export interface TossOrderDetail {
  orderId: string;
  clientOrderId?: string | null;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  timeInForce?: TimeInForce | string;
  status: OrderStatus;
  price?: string;
  quantity: string;
  orderAmount?: string | null;
  currency: Currency;
  orderedAt: string;
  canceledAt?: string | null;
  execution?: TossOrderExecution | null;
}

export interface GetOrderResponse {
  result: TossOrderDetail;
}

/** 예수금 균등 배분 결과 */
export interface BuyAllocation {
  symbol: string;
  strategyId: number;
  price: number;
  budget: number;
  quantity: number;
}

export interface ApprovedBuyExecution {
  cashBuyingPower: number;
  allocations: BuyAllocation[];
  skipped: Array<{ symbol: string; strategyId: number; reason: string }>;
  orders: Order[];
}

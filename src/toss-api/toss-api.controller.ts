import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TossApiService } from './toss-api.service.js';
import type {
  AccountBalanceResponse,
  ApprovedBuyExecution,
  BuyingPower,
  Order,
  PriceCheckResult,
  TossAccount,
  TossOrderDetail,
} from './interfaces/toss-api.interface.js';

@Controller('toss')
export class TossApiController {
  constructor(private readonly tossApiService: TossApiService) {}

  /**
   * GET /toss/balance
   * 계좌 잔고 및 보유 종목 확인 (테스트용)
   * - 예수금: KRW만 반환
   * - 보유주식: 국내 주식만 반환 (해외 주식 제외)
   */
  @Get('balance')
  async getBalance(): Promise<{
    accounts: TossAccount[];
    holdings: AccountBalanceResponse;
    buyingPowerKRW: BuyingPower;
  }> {
    const [accounts, holdings, buyingPowerKRW] = await Promise.all([
      this.tossApiService.getAccounts(),
      this.tossApiService.getMyAccountBalanceKROnly(), // 국내 주식만
      this.tossApiService.getBuyingPower('KRW'), // KRW만
    ]);

    return { accounts, holdings, buyingPowerKRW };
  }

  /**
   * GET /toss/price/:symbol
   * 현재가 확인 (테스트용)
   * 예: GET /toss/price/005930
   */
  @Get('price/:symbol')
  checkPrice(@Param('symbol') symbol: string): Promise<PriceCheckResult> {
    return this.tossApiService.getCurrentPrice(symbol);
  }

  /**
   * GET /toss/market-status
   * 한국 장 운영 시간 확인 (주문 가능 여부)
   */
  @Get('market-status')
  getMarketStatus() {
    return this.tossApiService.getKRMarketStatus();
  }

  /**
   * POST /toss/order/buy
   * 매수 테스트용 엔드포인트
   * Body: { symbol: string, orderType?: 'MARKET' | 'LIMIT', price?: string }
   */
  @Post('order/buy')
  async buyOrder(
    @Body()
    body: {
      symbol: string;
      orderType?: 'MARKET' | 'LIMIT';
      price?: string;
    },
  ): Promise<Order> {
    const { symbol, orderType = 'MARKET', price } = body;

    if (orderType === 'LIMIT') {
      if (!price) {
        throw new Error('지정가 주문 시 price를 입력해야 합니다.');
      }
      return this.tossApiService.buyLimit1Share(symbol, price);
    }

    return this.tossApiService.buyMarket1Share(symbol);
  }

  /**
   * POST /toss/order/execute-approved
   * 오늘 슬랙 승인된 종목에 예수금을 균등 배분해 시장가 매수
   */
  @Post('order/execute-approved')
  executeApprovedBuys(): Promise<ApprovedBuyExecution> {
    return this.tossApiService.executeApprovedBuys();
  }

  /**
   * POST /toss/order/sell
   * 매도 테스트용 엔드포인트
   * Body: { symbol: string, orderType?: 'MARKET' | 'LIMIT', price?: string }
   */
  @Post('order/sell')
  async sellOrder(
    @Body()
    body: {
      symbol: string;
      orderType?: 'MARKET' | 'LIMIT';
      price?: string;
      quantity?: number;
    },
  ): Promise<Order> {
    const { symbol, orderType = 'MARKET', price, quantity = 1 } = body;

    if (orderType === 'LIMIT') {
      if (!price) {
        throw new Error('지정가 주문 시 price를 입력해야 합니다.');
      }
      return this.tossApiService.sellLimit1Share(symbol, price);
    }

    return this.tossApiService.sellMarketShares(symbol, quantity);
  }

  /**
   * GET /toss/order/:orderId
   * 토스 주문 체결 상세 조회
   */
  @Get('order/:orderId')
  getOrder(@Param('orderId') orderId: string): Promise<TossOrderDetail> {
    return this.tossApiService.getOrder(orderId);
  }
}

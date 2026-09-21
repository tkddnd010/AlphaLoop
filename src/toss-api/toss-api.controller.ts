import { Controller, Get, Query } from '@nestjs/common';
import { TossApiService } from './toss-api.service.js';
import type {
  AccountBalanceResponse,
  BuyingPower,
  Currency,
  TossAccount,
} from './interfaces/toss-api.interface.js';

@Controller('api/v1')
export class TossApiController {
  constructor(private readonly tossApiService: TossApiService) {}

  /**
   * GET /api/v1/accounts
   * 계좌 목록 조회 → 토스 GET /api/v1/accounts 프록시
   */
  @Get('accounts')
  getAccounts(): Promise<TossAccount[]> {
    return this.tossApiService.getAccounts();
  }

  /**
   * GET /api/v1/holdings?symbol=005930
   * 보유 주식 조회 → 토스 GET /api/v1/holdings 프록시
   * symbol 생략 시 전체 보유 종목
   */
  @Get('holdings')
  getHoldings(
    @Query('symbol') symbol?: string,
  ): Promise<AccountBalanceResponse> {
    return this.tossApiService.getMyAccountBalance(symbol);
  }

  /**
   * GET /api/v1/buying-power?currency=KRW
   * 현금 매수 가능 금액(예수금에 가장 가까운 값) 조회
   */
  @Get('buying-power')
  getBuyingPower(
    @Query('currency') currency: Currency = 'KRW',
  ): Promise<BuyingPower> {
    return this.tossApiService.getBuyingPower(currency);
  }
}

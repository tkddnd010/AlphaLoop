import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { NaverFinanceService } from './naver-finance.service.js';
import { NaverFinanceController } from './naver-finance.controller.js';

@Module({
  imports: [HttpModule],
  controllers: [NaverFinanceController],
  providers: [NaverFinanceService],
  exports: [NaverFinanceService],
})
export class NaverFinanceModule {}

import { Module, Global } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global() // 전역 모듈로 설정하여 어디서든 PrismaService 사용 가능
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

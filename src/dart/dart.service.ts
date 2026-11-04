import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';
import { unzipSync, strFromU8 } from 'fflate';
import type {
  DartListResponse,
  DartDisclosure,
  DartSearchFilter,
  StockDisclosureSummary,
  MajorStockDetail,
  ExecutiveStockDetail,
  TreasuryDisposalDetail,
  DisclosureCorrection,
  IrEventDetail,
  MoneyLendingDetail,
  ShortTermBorrowingDetail,
  DartFinancialItem,
} from './interfaces/dart.interface.js';
import {
  parseReportPeriod,
  parseFinancialSummary,
  formatFinancialSummary,
} from './parsers/periodic-report.parser.js';
import {
  parseRightsIssue,
  formatRightsIssue,
  parseConvertibleBond,
  formatConvertibleBond,
  parseTreasuryAcquisition,
  formatTreasuryAcquisition,
  parseMerger,
  formatMerger,
} from './parsers/major-report.parsers.js';
import {
  parseSupplyContract,
  formatSupplyContract,
} from './parsers/exchange-disclosure.parsers.js';
import {
  parseCapitalReduction,
  formatCapitalReduction,
  parseOtherCorpTransfer,
  parseOtherCorpTrade,
  formatOtherCorpStock,
  parseDebtGuarantee,
  parseCollateralProvision,
  formatGuarantee,
  parseShareCancel,
  formatShareCancel,
  parseLargestShareholderChange,
  parseLargestShareholderDeal,
  parseLargestShareholderPledge,
  formatLargestShareholder,
  parseLawsuitMajor,
  parseLawsuitExchange,
  formatLawsuit,
  parseDividend,
  formatDividend,
  parseSecuritiesIssueResult,
  formatSecuritiesIssueResult,
  parseRumorClarification,
  formatRumorClarification,
  parseManagementMatter,
  formatManagementMatter,
  parseFacilityInvestment,
  formatFacilityInvestment,
  parseTreasuryTrustSign,
  parseTreasuryTrustCancel,
  formatTreasuryTrust,
  parseBonusIssue,
  formatBonusIssue,
  parseSplit,
  formatSplit,
  parseTangibleAssetMajor,
  parseTangibleAssetAcquire,
  formatTangibleAsset,
  parseSupplyContractCancel,
  formatSupplyContractCancel,
  parseConversionPriceAdjust,
  formatConversionPriceAdjust,
  parseShareConsolidation,
  formatShareConsolidation,
  parseEmbezzlement,
  formatEmbezzlement,
  parseRehabilitation,
  formatRehabilitation,
  parseOwnCbBuyback,
  formatOwnCbBuyback,
  parsePreliminaryEarnings,
  formatPreliminaryEarnings,
} from './parsers/event-disclosure.parsers.js';

@Injectable()
export class DartService {
  private readonly logger = new Logger(DartService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://opendart.fss.or.kr/api';

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.apiKey = this.configService.getOrThrow<string>('DART_API_KEY');
    this.logger.log('✅ DART API Service initialized');
  }

  /**
   * 종목코드로 최근 공시 조회
   * @param stockCode 종목코드 (6자리)
   * @param days 조회할 기간 (일 수, 기본 30일)
   * @returns 공시 목록
   */
  async getRecentDisclosures(
    stockCode: string,
    days = 30,
  ): Promise<DartDisclosure[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const filter: DartSearchFilter = {
      stock_code: stockCode.padStart(6, '0'), // 6자리로 패딩
      bgn_de: this.formatDate(startDate),
      end_de: this.formatDate(endDate),
      page_count: 100, // 최대 100건
    };

    try {
      const response = await this.searchDisclosures(filter);

      if (response.status !== '000') {
        this.logger.warn(
          `⚠️ DART API 에러: ${response.message} (종목: ${stockCode})`,
        );
        return [];
      }

      this.logger.log(
        `✅ ${stockCode} 공시 조회 완료: ${response.total_count}건`,
      );

      return response.list || [];
    } catch (error) {
      this.logger.error(`❌ ${stockCode} 공시 조회 실패: ${error}`);
      return [];
    }
  }

  /**
   * DART API 공시검색
   */
  private async searchDisclosures(
    filter: DartSearchFilter,
  ): Promise<DartListResponse> {
    const params = new URLSearchParams({
      crtfc_key: this.apiKey,
      bgn_de: filter.bgn_de,
      end_de: filter.end_de || filter.bgn_de,
      page_no: String(filter.page_no || 1),
      page_count: String(filter.page_count || 10),
    });

    if (filter.corp_code) {
      params.append('corp_code', filter.corp_code);
    }
    if (filter.stock_code) {
      params.append('corp_code', ''); // stock_code 사용 시 corp_code는 빈 값
      params.append('stock_code', filter.stock_code);
    }
    if (filter.pblntf_ty) {
      params.append('pblntf_ty', filter.pblntf_ty);
    }

    const url = `${this.baseUrl}/list.json?${params.toString()}`;

    const { data } = await firstValueFrom(
      this.httpService.get<DartListResponse>(url, {
        timeout: 10_000,
      }),
    );

    return data;
  }

  /**
   * 여러 종목의 최근 공시 한번에 조회
   * @param stockCodes 종목코드 배열
   * @param days 조회 기간 (일 수)
   */
  async getMultipleStockDisclosures(
    stockCodes: string[],
    days = 30,
  ): Promise<StockDisclosureSummary[]> {
    const summaries: StockDisclosureSummary[] = [];

    for (const stockCode of stockCodes) {
      const disclosures = await this.getRecentDisclosures(stockCode, days);

      const hasImportant = disclosures.some((d) =>
        this.isImportantDisclosure(d.report_nm),
      );

      const latestDate =
        disclosures.length > 0 ? disclosures[0].rcept_dt : undefined;

      summaries.push({
        stockCode,
        companyName: disclosures[0]?.corp_name || stockCode,
        totalDisclosures: disclosures.length,
        recentDisclosures: disclosures.slice(0, 5), // 최근 5개만
        hasImportantDisclosure: hasImportant,
        latestDisclosureDate: latestDate,
      });

      // Rate Limit 방지 (초당 최대 100회)
      await this.sleep(100);
    }

    return summaries;
  }

  /**
   * 중요 공시인지 판단
   */
  private isImportantDisclosure(reportName: string): boolean {
    const importantKeywords = [
      '유상증자',
      '무상증자',
      '주식배당',
      '합병',
      '분할',
      '영업양수도',
      '자산양수도',
      '주요사항보고',
      '투자판단',
      '감사보고서',
      '분기보고서',
      '반기보고서',
      '사업보고서',
    ];

    return importantKeywords.some((keyword) => reportName.includes(keyword));
  }

  /**
   * Date를 YYYYMMDD 형식으로 변환
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * 지연 함수 (Rate Limit 방지)
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 공시 내용 요약 생성 (LLM 분석용) - 상세 설명 포함
   * @param disclosures 공시 목록
   * @returns 텍스트 요약
   */
  async generateDisclosureSummaryAsync(disclosures: DartDisclosure[]): Promise<string> {
    if (disclosures.length === 0) {
      return '📋 최근 30일 내 공시 없음\n\n⚠️ 분석할 공시가 없어 투자 판단이 어렵습니다.';
    }

    const lines: string[] = [];
    lines.push(`📋 최근 공시 ${disclosures.length}건\n`);

    for (const [index, d] of disclosures.slice(0, 10).entries()) {
      const date = this.formatDateReadable(d.rcept_dt);
      lines.push(`${index + 1}. [${date}] ${d.report_nm}`);

      // 공시 유형별로 원문을 파싱해 실제 수치를 사용 (공백 차이에 흔들리지 않도록 제목 공백 제거)
      const title = d.report_nm.replace(/\s/g, '');
      let detailLines: string[] | null = null;
      if (d.report_nm.includes('대량보유')) {
        const detail = await this.parseMajorStockDetail(d.rcept_no);
        if (detail) detailLines = this.formatMajorStockDetail(detail);
      } else if (d.report_nm.includes('임원') && d.report_nm.includes('소유상황')) {
        const detail = await this.parseExecutiveStockDetail(d.rcept_no);
        if (detail) detailLines = this.formatExecutiveStockDetail(detail);
      } else if (d.report_nm.replace(/\s/g, '').includes('자기주식처분')) {
        const detail = await this.parseTreasuryDisposalDetail(d.rcept_no);
        if (detail) detailLines = this.formatTreasuryDisposalDetail(detail);
      } else if (d.report_nm.includes('기업설명회')) {
        const detail = await this.parseIrEventDetail(d.rcept_no);
        if (detail) detailLines = this.formatIrEventDetail(detail);
      } else if (d.report_nm.includes('금전대여')) {
        const detail = await this.parseMoneyLendingDetail(d.rcept_no);
        if (detail) detailLines = this.formatMoneyLendingDetail(detail);
      } else if (d.report_nm.includes('단기차입금')) {
        const detail = await this.parseShortTermBorrowingDetail(d.rcept_no);
        if (detail) detailLines = this.formatShortTermBorrowingDetail(detail);
      } else if (
        (title.includes('유상증자결정') || title.includes('유무상증자')) &&
        !title.includes('종속회사')
      ) {
        detailLines = await this.detailLinesFrom(d.rcept_no, parseRightsIssue, formatRightsIssue);
      } else if (title.includes('무상증자결정')) {
        detailLines = await this.detailLinesFrom(d.rcept_no, parseBonusIssue, formatBonusIssue);
      } else if (title.includes('전환사채권발행결정')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseConvertibleBond,
          formatConvertibleBond,
        );
      } else if (title.includes('자기주식취득신탁계약해지')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseTreasuryTrustCancel,
          formatTreasuryTrust,
        );
      } else if (title.includes('자기주식취득신탁계약체결')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseTreasuryTrustSign,
          formatTreasuryTrust,
        );
      } else if (title.includes('자기주식취득결정')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseTreasuryAcquisition,
          formatTreasuryAcquisition,
        );
      } else if (title.includes('자기전환사채만기전취득')) {
        detailLines = await this.detailLinesFrom(d.rcept_no, parseOwnCbBuyback, formatOwnCbBuyback);
      } else if (title.includes('회사합병결정')) {
        detailLines = await this.detailLinesFrom(d.rcept_no, parseMerger, formatMerger);
      } else if (title.includes('회사분할결정')) {
        detailLines = await this.detailLinesFrom(d.rcept_no, parseSplit, formatSplit);
      } else if (title.includes('감자결정') && !title.includes('종속회사')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseCapitalReduction,
          formatCapitalReduction,
        );
      } else if (title.includes('단일판매') && title.includes('해지')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseSupplyContractCancel,
          formatSupplyContractCancel,
        );
      } else if (title.includes('단일판매')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseSupplyContract,
          formatSupplyContract,
        );
      } else if (title.includes('타법인주식') && (title.includes('양수결정') || title.includes('양도결정'))) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseOtherCorpTransfer,
          formatOtherCorpStock,
        );
      } else if (title.includes('타법인주식') && (title.includes('취득결정') || title.includes('처분결정'))) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseOtherCorpTrade,
          formatOtherCorpStock,
        );
      } else if (title.includes('유형자산양수') || title.includes('유형자산양도')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseTangibleAssetMajor,
          formatTangibleAsset,
        );
      } else if (title.includes('유형자산취득')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseTangibleAssetAcquire,
          formatTangibleAsset,
        );
      } else if (title.includes('채무보증')) {
        detailLines = await this.detailLinesFrom(d.rcept_no, parseDebtGuarantee, formatGuarantee);
      } else if (title.includes('담보제공결정') && !title.includes('최대주주')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseCollateralProvision,
          formatGuarantee,
        );
      } else if (title.includes('주식소각')) {
        detailLines = await this.detailLinesFrom(d.rcept_no, parseShareCancel, formatShareCancel);
      } else if (title.includes('최대주주변경을수반하는주식양수도')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseLargestShareholderDeal,
          formatLargestShareholder,
        );
      } else if (title.includes('최대주주변경을수반하는주식담보')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseLargestShareholderPledge,
          formatLargestShareholder,
        );
      } else if (title.includes('최대주주변경') && !title.includes('소유주식변동')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseLargestShareholderChange,
          formatLargestShareholder,
        );
      } else if (title.includes('소송') && title.includes('주요사항보고서')) {
        detailLines = await this.detailLinesFrom(d.rcept_no, parseLawsuitMajor, formatLawsuit);
      } else if (title.includes('소송')) {
        detailLines = await this.detailLinesFrom(d.rcept_no, parseLawsuitExchange, formatLawsuit);
      } else if (title.includes('배당결정') || title.includes('현금ㆍ현물배당') || title.includes('현금·현물배당')) {
        detailLines = await this.detailLinesFrom(d.rcept_no, parseDividend, formatDividend);
      } else if (title.includes('증권발행결과')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseSecuritiesIssueResult,
          formatSecuritiesIssueResult,
        );
      } else if (title.includes('풍문') || title.includes('조회공시요구')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseRumorClarification,
          formatRumorClarification,
        );
      } else if (title.includes('투자판단관련')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseManagementMatter,
          formatManagementMatter,
        );
      } else if (title.includes('신규시설투자')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseFacilityInvestment,
          formatFacilityInvestment,
        );
      } else if (title.includes('전환가액')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseConversionPriceAdjust,
          formatConversionPriceAdjust,
        );
      } else if (title.includes('주식병합결정')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseShareConsolidation,
          formatShareConsolidation,
        );
      } else if (title.includes('횡령') || title.includes('배임')) {
        detailLines = await this.detailLinesFrom(d.rcept_no, parseEmbezzlement, formatEmbezzlement);
      } else if (title.includes('회생절차')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parseRehabilitation,
          formatRehabilitation,
        );
      } else if (title.includes('잠정)실적') || title.includes('잠정실적')) {
        detailLines = await this.detailLinesFrom(
          d.rcept_no,
          parsePreliminaryEarnings,
          formatPreliminaryEarnings,
        );
      } else if (/(사업|반기|분기)보고서\(\d{4}\.\d{2}\)/.test(title)) {
        // 정기보고서: 원문 대신 재무제표 API 로 매출/영업이익/순이익을 가져온다
        detailLines = await this.getFinancialSummaryLines(d.corp_code, d.report_nm);
      }

      if (detailLines) {
        // 원문 수치가 있으면 "상세 확인 필요" 같은 일반 설명은 생략 (LLM이 정보 부족으로 오판하지 않도록)
        lines.push(...detailLines);
      } else {
        const explanation = this.explainDisclosure(d.report_nm);
        if (explanation) {
          lines.push(`   💡 ${explanation}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * 기존 동기 버전 (하위 호환성)
   */
  generateDisclosureSummary(disclosures: DartDisclosure[]): string {
    if (disclosures.length === 0) {
      return '📋 최근 30일 내 공시 없음\n\n⚠️ 분석할 공시가 없어 투자 판단이 어렵습니다.';
    }

    const lines: string[] = [];
    lines.push(`📋 최근 공시 ${disclosures.length}건\n`);

    disclosures.slice(0, 10).forEach((d, index) => {
      const date = this.formatDateReadable(d.rcept_dt);
      const explanation = this.explainDisclosure(d.report_nm);
      
      lines.push(`${index + 1}. [${date}] ${d.report_nm}`);
      if (explanation) {
        lines.push(`   💡 ${explanation}`);
      }
    });

    return lines.join('\n');
  }

  /**
   * 공시 유형별 상세 설명 생성
   * @param reportName 공시명
   * @returns 설명 텍스트
   */
  private explainDisclosure(reportName: string): string {
    // 원문 수치를 읽지 못했을 때의 대체 설명이다.
    // 호재/악재 판정은 하지 않고(= LLM 이 편향되지 않도록) 공시가 무엇인지만 중립적으로 서술한다.
    const name = reportName.replace(/\s/g, '');

    if (name.includes('유상증자')) {
      return '유상증자: 신주 발행으로 자금 조달. 희석률·자금 용도·배정 대상에 따라 영향이 달라지며, 세부 수치는 확인되지 않음.';
    }
    if (name.includes('무상증자')) {
      return '무상증자: 주주에게 무상으로 신주 배정. 배정 비율 등 세부 내용은 확인되지 않음.';
    }
    if (name.includes('주식배당')) {
      return '주식배당: 배당을 주식으로 지급. 배당률 등 세부 내용은 확인되지 않음.';
    }
    if (name.includes('기업설명회') || name.includes('IR')) {
      return 'IR 개최: 투자자 대상 기업 설명회. 개최 사실 자체는 중립이며 설명 내용은 확인되지 않음.';
    }
    if (name.includes('대량보유')) {
      return '대량보유 보고: 5% 이상 지분 변동 보고. 증감 방향과 폭은 확인되지 않음.';
    }
    if (name.includes('임원') && name.includes('소유상황')) {
      return '임원·주요주주 소유 변동 보고. 증감 여부와 변동 사유(매매/주식병합 등)는 확인되지 않음.';
    }
    if (name.includes('자기주식')) {
      // 신탁 해지는 "취득"이라는 단어가 들어 있어도 매입이 아니므로 먼저 분기한다
      if (name.includes('해지')) {
        return '자기주식 신탁계약 해지: 자사주 취득용 신탁이 종료됨. 매입 호재가 아니며 해지 사유와 처분 여부는 확인되지 않음.';
      }
      if (name.includes('취득')) {
        return '자기주식 취득: 회사가 자사주를 취득. 규모(발행주식 대비 %)와 방법은 확인되지 않음.';
      }
      if (name.includes('처분')) {
        return '자기주식 처분: 보유 자사주를 처분. 처분 목적(임직원 보상/시장 매각 등)과 규모는 확인되지 않음.';
      }
    }
    if (name.includes('단기차입금')) {
      return '단기차입금 증가 결정. 금액과 자기자본 대비 비중은 확인되지 않음.';
    }
    if (name.includes('영업정지') || name.includes('거래정지')) {
      return '영업/거래정지 관련 공시. 정지 사유와 기간을 확인해야 함.';
    }
    if (name.includes('감사의견') && name.includes('거절')) {
      return '감사의견 거절 관련 공시: 회계 투명성 문제와 연결될 수 있음.';
    }

    // 정기 보고서
    if (name.includes('사업보고서')) {
      return '사업보고서: 연간 실적 및 사업 현황 보고. 실적 수치는 확인되지 않음.';
    }
    if (name.includes('분기보고서')) {
      return '분기보고서: 분기 실적 보고. 실적 수치는 확인되지 않음.';
    }
    if (name.includes('반기보고서')) {
      return '반기보고서: 상반기 실적 보고. 실적 수치는 확인되지 않음.';
    }

    // 기타
    if (name.includes('합병')) {
      return '합병: 기업 결합. 합병 조건과 상대 회사 정보는 확인되지 않음.';
    }
    if (name.includes('금전대여')) {
      return '금전대여: 타 법인에 자금 대여. 금액·자기자본 대비 비중·회수 가능성은 확인되지 않음.';
    }
    if (name.includes('감자')) {
      return '감자: 자본금 감소. 유상/무상·감자비율은 확인되지 않음.';
    }
    if (name.includes('타법인주식')) {
      return '타법인 주식 취득·처분. 규모(자기자본 대비 %)와 목적은 확인되지 않음.';
    }
    if (name.includes('채무보증')) {
      return '타인에 대한 채무보증. 보증 금액과 자기자본 대비 비중은 확인되지 않음.';
    }
    if (name.includes('담보제공')) {
      return '타인에 대한 담보 제공. 담보 금액과 자기자본 대비 비중은 확인되지 않음.';
    }
    if (name.includes('주식소각')) {
      return '주식소각: 자기주식 등을 소각. 규모는 확인되지 않음.';
    }
    if (name.includes('최대주주')) {
      return '최대주주 관련 공시. 변경 전후 지분율은 확인되지 않음.';
    }
    if (name.includes('소송')) {
      return '소송 제기 또는 판결. 청구 내용과 금액은 확인되지 않음.';
    }
    if (name.includes('배당')) {
      return '배당 결정. 1주당 배당금과 총액은 확인되지 않음.';
    }
    if (name.includes('횡령') || name.includes('배임')) {
      return '횡령·배임 혐의 관련 공시. 금액과 자기자본 대비 비중은 확인되지 않음.';
    }
    if (name.includes('회생')) {
      return '회생절차 관련 공시. 신청 사유와 진행 상황은 확인되지 않음.';
    }

    return ''; // 설명이 없는 경우 빈 문자열
  }

  /**
   * YYYYMMDD를 YYYY-MM-DD로 변환
   */
  private formatDateReadable(dateStr: string): string {
    if (dateStr.length !== 8) return dateStr;
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }

  /**
   * 공시 원문 조회
   * DART document.xml 은 ZIP(안에 XML 1개)으로 응답한다.
   * 오류 시에는 ZIP 이 아닌 XML(<result><status/><message/>)로 응답한다.
   * @param rcept_no 접수번호
   * @returns 원문 XML 문자열
   */
  async getDisclosureDocument(rcept_no: string): Promise<string> {
    const response = await firstValueFrom(
      this.httpService.get('https://opendart.fss.or.kr/api/document.xml', {
        params: {
          crtfc_key: this.apiKey,
          rcept_no,
        },
        responseType: 'arraybuffer',
      }),
    );

    const bytes = new Uint8Array(response.data as ArrayBuffer);

    // ZIP 시그니처(PK\x03\x04) 확인
    const isZip =
      bytes.length > 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04;

    if (!isZip) {
      const body = strFromU8(bytes);
      const status = /<status>(.*?)<\/status>/.exec(body)?.[1];
      const message = /<message>(.*?)<\/message>/.exec(body)?.[1];
      throw new Error(`DART 원문 조회 오류 (${rcept_no}): [${status}] ${message}`);
    }

    const files = unzipSync(bytes);
    const name = Object.keys(files).find((n) => /\.(xml|html?)$/i.test(n));
    if (!name) {
      throw new Error(`DART 원문 ZIP 안에 문서 파일이 없습니다 (${rcept_no})`);
    }

    return strFromU8(files[name]);
  }

  /**
   * 대량보유 상황 상세 파싱
   * @param rcept_no 접수번호
   * @returns 대량보유 상세 정보
   */
  async parseMajorStockDetail(rcept_no: string): Promise<MajorStockDetail | null> {
    try {
      const xml = await this.getDisclosureDocument(rcept_no);
      const $ = cheerio.load(xml, { xmlMode: true });

      // DART 원문 XML 은 값 셀마다 ACODE(또는 AUNIT) 속성으로 항목을 식별한다.
      const byCode = (code: string): string =>
        $(`[ACODE="${code}"]`).first().text().replace(/\s+/g, ' ').trim();
      const byUnit = (unit: string): string =>
        $(`[AUNIT="${unit}"]`).first().text().replace(/\s+/g, ' ').trim();

      const reporter = byCode('RPT_RSP_NM');
      const currShares = this.toNumber(byCode('SUM_TMT_CNT'));
      const currRatio = this.toNumber(byCode('SUM_TMT_RT'));

      // 보고자도, 이번 보유 수치도 없으면 대량보유 보고서 요약표가 아니라고 판단
      if (!reporter && currShares === null && currRatio === null) {
        this.logger.warn(`대량보유 요약 정보를 찾을 수 없음: ${rcept_no}`);
        return null;
      }

      const prevShares = this.toNumber(byCode('SUM_BMT_CNT'));
      const prevRatio = this.toNumber(byCode('SUM_BMT_RT'));

      return {
        rcept_no,
        reporter,
        reportType: byUnit('RPT_DST1'),
        holdingPurpose: byUnit('PUR_OWN'),
        reportReason: byCode('SUM_CHN_RWN'),
        prevShares,
        prevRatio,
        currShares,
        currRatio,
        sharesChange:
          prevShares !== null && currShares !== null ? currShares - prevShares : null,
        ratioChange:
          prevRatio !== null && currRatio !== null
            ? Math.round((currRatio - prevRatio) * 100) / 100
            : null,
        parsedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`대량보유 파싱 실패 (${rcept_no}): ${error}`);
      return null;
    }
  }

  /**
   * 대량보유 상세 정보를 LLM 입력용 텍스트 줄로 변환
   */
  private formatMajorStockDetail(d: MajorStockDetail): string[] {
    const fmt = (n: number | null, suffix = ''): string =>
      n === null ? '정보 없음' : `${n.toLocaleString('ko-KR')}${suffix}`;
    const signed = (n: number | null, suffix = ''): string =>
      n === null ? '정보 없음' : `${n > 0 ? '+' : ''}${n.toLocaleString('ko-KR')}${suffix}`;

    let direction = '';
    if (d.ratioChange !== null) {
      direction =
        d.ratioChange > 0 ? '지분 증가' : d.ratioChange < 0 ? '지분 감소' : '지분 변동 없음';
    }

    const lines = ['   📊 상세 (원문 파싱):'];
    if (d.reporter) lines.push(`      • 보고자: ${d.reporter}`);
    if (d.reportType) lines.push(`      • 보고구분: ${d.reportType}`);
    lines.push(
      `      • 보유주식수: ${fmt(d.prevShares, '주')} → ${fmt(d.currShares, '주')} (${signed(d.sharesChange, '주')})`,
    );
    lines.push(
      `      • 보유비율: ${fmt(d.prevRatio, '%')} → ${fmt(d.currRatio, '%')} (${signed(d.ratioChange, '%p')})${direction ? ` ⇒ ${direction}` : ''}`,
    );
    if (d.holdingPurpose) lines.push(`      • 보유목적: ${d.holdingPurpose}`);
    if (d.reportReason) lines.push(`      • 보고사유: ${d.reportReason}`);
    return lines;
  }

  /**
   * 임원·주요주주 특정증권등 소유상황보고서 원문 파싱
   * @param rcept_no 접수번호
   * @returns 소유상황 상세 정보 (실패 시 null)
   */
  async parseExecutiveStockDetail(rcept_no: string): Promise<ExecutiveStockDetail | null> {
    try {
      const xml = await this.getDisclosureDocument(rcept_no);
      const $ = cheerio.load(xml, { xmlMode: true });

      const clean = (t: string): string => t.replace(/\s+/g, ' ').trim();
      const byCode = (code: string): string => clean($(`[ACODE="${code}"]`).first().text());
      const byUnit = (unit: string): string => clean($(`[AUNIT="${unit}"]`).first().text());
      const meaningful = (t: string): string => (t === '-' ? '' : t);

      const holderName = byCode('IFR_NM');
      const currShares = this.toNumber(byCode('AFR_UN_CNT'));
      const currRatio = this.toNumber(byCode('AFR_UN_RT'));

      if (!holderName && currShares === null && currRatio === null) {
        this.logger.warn(`임원·주요주주 소유 정보를 찾을 수 없음: ${rcept_no}`);
        return null;
      }

      const prevShares = this.toNumber(byCode('BFR_UN_CNT'));
      const prevRatio = this.toNumber(byCode('BFR_UN_RT'));

      // 증감은 보고서에 적힌 값을 우선 사용하고, 없으면 직접 계산
      const sharesChange =
        this.toNumber(byCode('MDF_UN_CNT')) ??
        (prevShares !== null && currShares !== null ? currShares - prevShares : null);
      const ratioChange =
        this.toNumber(byCode('MDF_UN_RT')) ??
        (prevRatio !== null && currRatio !== null
          ? Math.round((currRatio - prevRatio) * 100) / 100
          : null);

      // 변동 사유는 거래 행마다 하나씩 있으므로 모두 모은다 (중복 제거)
      const reasons = [
        ...new Set(
          $('[AUNIT="RPT_RSN"]')
            .map((_, el) => clean($(el).text()))
            .get()
            .filter((t) => t && t !== '-'),
        ),
      ];

      // 주식병합·분할 등은 보유 "수량"만 바뀌는 것이지 매수/매도가 아니다
      const adjustmentPattern = /병합|분할|무상|주식배당|감자|액면/;
      const isShareAdjustmentOnly =
        reasons.length > 0 && reasons.every((r) => adjustmentPattern.test(r));

      const roleParts = [
        meaningful(byUnit('STF_RYN')),
        meaningful(byCode('STF_PSM')),
        meaningful(byUnit('MAIN_SH')),
      ].filter(Boolean);

      return {
        rcept_no,
        holderName,
        holderType: byUnit('IFR_TP'),
        role: roleParts.join(' / '),
        reportType: byUnit('RPT_DST'),
        prevShares,
        currShares,
        sharesChange,
        prevRatio,
        currRatio,
        ratioChange,
        reasons,
        remarks: meaningful(byCode('SUM_RMK') || byCode('RMK')),
        isShareAdjustmentOnly,
        parsedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`임원·주요주주 소유상황 파싱 실패 (${rcept_no}): ${error}`);
      return null;
    }
  }

  /**
   * 임원·주요주주 소유 상세 정보를 LLM 입력용 텍스트 줄로 변환
   */
  private formatExecutiveStockDetail(d: ExecutiveStockDetail): string[] {
    const fmt = (n: number | null, suffix = ''): string =>
      n === null ? '정보 없음' : `${n.toLocaleString('ko-KR')}${suffix}`;
    const signed = (n: number | null, suffix = ''): string =>
      n === null ? '정보 없음' : `${n > 0 ? '+' : ''}${n.toLocaleString('ko-KR')}${suffix}`;

    const lines = ['   📊 상세 (원문 파싱):'];
    lines.push(
      `      • 보고자: ${d.holderName}${d.holderType ? ` (${d.holderType})` : ''}${d.role ? ` - ${d.role}` : ''}`,
    );
    if (d.reportType) lines.push(`      • 보고구분: ${d.reportType}`);
    lines.push(
      `      • 보유주식수: ${fmt(d.prevShares, '주')} → ${fmt(d.currShares, '주')} (${signed(d.sharesChange, '주')})`,
    );
    lines.push(
      `      • 보유비율: ${fmt(d.prevRatio, '%')} → ${fmt(d.currRatio, '%')} (${signed(d.ratioChange, '%p')})`,
    );
    if (d.reasons.length > 0) lines.push(`      • 변동사유: ${d.reasons.join(', ')}`);
    if (d.remarks) lines.push(`      • 비고: ${d.remarks}`);
    if (d.isShareAdjustmentOnly) {
      lines.push(
        '      • ⚠️ 주식병합/분할 등 수량 조정에 따른 변동입니다. 매수·매도가 아니므로 보유주식수 증감을 지분 변화로 해석하지 말고, 보유비율 변화만 보세요.',
      );
    }
    return lines;
  }

  /**
   * 주요사항보고서(자기주식 처분 결정) 원문 파싱 (기재정정 공시 포함)
   * @param rcept_no 접수번호
   * @returns 자기주식 처분 상세 정보 (실패 시 null)
   */
  async parseTreasuryDisposalDetail(rcept_no: string): Promise<TreasuryDisposalDetail | null> {
    try {
      const xml = await this.getDisclosureDocument(rcept_no);
      const $ = cheerio.load(xml, { xmlMode: true });

      const clean = (t: string): string => t.replace(/\s+/g, ' ').trim();
      const byCode = (code: string): string => clean($(`[ACODE="${code}"]`).first().text());
      const byUnit = (unit: string): string => clean($(`[AUNIT="${unit}"]`).first().text());
      const splitList = (t: string): string => this.splitDashList(t);

      const shares = this.toNumber(byCode('SEL_OSTK'));
      const amount = this.toNumber(byCode('SEL_OSTK_PRC'));
      if (shares === null && amount === null) {
        this.logger.warn(`자기주식 처분 정보를 찾을 수 없음: ${rcept_no}`);
        return null;
      }

      const heldBefore = this.toNumber(byCode('HLD_OSTK'));
      const heldBeforeRatio = this.toNumber(byCode('HLD_OSTK_RT'));

      // 발행주식 총수는 공시에 직접 나오지 않으므로 (보유수 ÷ 보유비율)로 추정한다.
      // 보유비율이 소수 둘째 자리 반올림 값이라 약간의 오차가 있다.
      const ratioOfIssued =
        shares !== null && heldBefore && heldBeforeRatio
          ? Math.round(((shares / (heldBefore / (heldBeforeRatio / 100))) * 100) * 100) / 100
          : null;

      const methodCodes: [string, string][] = [
        ['주주균등처분', 'SEL_MTH_EDS'],
        ['시간외대량매매', 'SEL_MTH_OVT'],
        ['장외처분', 'SEL_MTH_OMRK'],
        ['기타', 'SEL_MTH_ETC'],
      ];
      const methods: { label: string; shares: number }[] = [];
      for (const [label, code] of methodCodes) {
        const value = this.toNumber(byCode(code));
        if (value !== null && value > 0) methods.push({ label, shares: value });
      }

      // 기재정정 공시: <CORRECTION> 안의 정정사항 표 (항목 / 정정사유 / 정정 전 / 정정 후)
      const corrections: DisclosureCorrection[] = [];
      $('CORRECTION TR').each((_, tr) => {
        const cells = $(tr)
          .children('TD')
          .map((__, td) => clean($(td).text()))
          .get();
        if (cells.length >= 4) {
          corrections.push({
            item: cells[0],
            reason: cells[1],
            before: cells[2],
            after: cells[3],
          });
        }
      });

      return {
        rcept_no,
        decisionDate: byUnit('SEL_DATE'),
        shares,
        otherShares: this.toNumber(byCode('SEL_ESTK')),
        pricePerShare: this.toNumber(byCode('SEL_OSTK_SPRC')),
        amount,
        periodStart: byUnit('SEL_BGN'),
        periodEnd: byUnit('SEL_END'),
        purpose: splitList(byCode('SEL_PPS')),
        methods,
        counterparty: splitList(byCode('DSPS_PARN')),
        heldBefore,
        heldBeforeRatio,
        ratioOfIssued,
        corrections,
        parsedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`자기주식 처분 파싱 실패 (${rcept_no}): ${error}`);
      return null;
    }
  }

  /**
   * 자기주식 처분 상세 정보를 LLM 입력용 텍스트 줄로 변환
   */
  private formatTreasuryDisposalDetail(d: TreasuryDisposalDetail): string[] {
    const won = (n: number | null): string =>
      n === null ? '정보 없음' : `${n.toLocaleString('ko-KR')}원`;

    const lines = ['   📊 상세 (원문 파싱):'];

    if (d.corrections.length > 0) {
      const text = d.corrections
        .map((c) => `${c.item}: ${c.before} → ${c.after}${c.reason ? ` (정정사유: ${c.reason})` : ''}`)
        .join('; ');
      lines.push(`      • 기재정정: ${text}`);
    }

    if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);

    const sharesText =
      d.shares === null ? '정보 없음' : `${d.shares.toLocaleString('ko-KR')}주`;
    lines.push(
      `      • 처분 주식수: ${sharesText}${d.ratioOfIssued !== null ? ` (발행주식 대비 약 ${d.ratioOfIssued}%)` : ''}`,
    );
    if (d.otherShares) {
      lines.push(`      • 처분 기타주식: ${d.otherShares.toLocaleString('ko-KR')}주`);
    }
    lines.push(
      `      • 처분 단가: ${won(d.pricePerShare)} / 처분 예정금액: ${won(d.amount)}${d.amount !== null ? ` (약 ${(d.amount / 1e8).toFixed(1)}억원)` : ''}`,
    );
    if (d.periodStart || d.periodEnd) {
      lines.push(`      • 처분 예정기간: ${d.periodStart || '?'} ~ ${d.periodEnd || '?'}`);
    }
    if (d.purpose) lines.push(`      • 처분 목적: ${d.purpose}`);
    if (d.methods.length > 0) {
      lines.push(
        `      • 처분 방법: ${d.methods.map((m) => `${m.label} ${m.shares.toLocaleString('ko-KR')}주`).join(', ')}`,
      );
    }
    if (d.counterparty) lines.push(`      • 처분 상대방: ${d.counterparty}`);
    if (d.heldBefore !== null) {
      lines.push(
        `      • 처분 전 자기주식: ${d.heldBefore.toLocaleString('ko-KR')}주${d.heldBeforeRatio !== null ? ` (${d.heldBeforeRatio}%)` : ''}`,
      );
    }

    // 처분 방법이 시장 밖 거래뿐이면 '단기 매물 출회' 로 단정하지 않도록 사실을 알려준다
    const offMarket = ['시간외대량매매', '장외처분', '주주균등처분'];
    if (d.methods.length > 0 && d.methods.every((m) => offMarket.includes(m.label))) {
      lines.push(
        '      • 참고: 처분 방법이 모두 시장 밖 거래(시간외대량매매/장외처분/주주균등처분)이며 장내 일반 매도 물량은 확인되지 않습니다.',
      );
    }
    return lines;
  }

  /**
   * 기업설명회(IR) 개최 공시 원문 파싱
   * 거래소 자유서식(HTML)이라 ACODE 가 없으므로, 라벨 칸("2. 장소" 등) 바로 다음 칸을 값으로 읽는다.
   * @param rcept_no 접수번호
   * @returns IR 개최 상세 정보 (실패 시 null)
   */
  async parseIrEventDetail(rcept_no: string): Promise<IrEventDetail | null> {
    try {
      const xml = await this.getDisclosureDocument(rcept_no);
      const $ = cheerio.load(xml, { xmlMode: true });

      const clean = (t: string): string => t.replace(/\s+/g, ' ').trim();

      // 라벨 칸 바로 다음 칸의 텍스트
      const valueAfter = (label: RegExp): string => {
        const labelCell = $('td')
          .filter((_, el) => label.test(clean($(el).text())))
          .first();
        return labelCell.length ? clean(labelCell.next('td').text()) : '';
      };

      // 일시: "시작일 / 종료일 / 시작시간 / 종료시간" 헤더 행 바로 아래 행에 값 4개가 있다
      let startDate = '';
      let endDate = '';
      let startTime = '';
      let endTime = '';
      const startHeader = $('td')
        .filter((_, el) => clean($(el).text()) === '시작일')
        .first();
      if (startHeader.length) {
        const values = startHeader
          .closest('tr')
          .next('tr')
          .find('td')
          .map((_, el) => clean($(el).text()))
          .get();
        [startDate = '', endDate = '', startTime = '', endTime = ''] = values;
      }

      const place = valueAfter(/^\d+\.\s*장소$/);
      const purpose = valueAfter(/^\d+\.\s*실시목적$/);

      // 일시도 목적도 없으면 IR 개최 양식이 아니라고 판단
      if (!startDate && !purpose && !place) {
        this.logger.warn(`IR 개최 정보를 찾을 수 없음: ${rcept_no}`);
        return null;
      }

      return {
        rcept_no,
        startDate,
        endDate,
        startTime,
        endTime,
        place,
        audience: valueAfter(/^\d+\.\s*대상자$/),
        purpose,
        method: this.splitDashList(valueAfter(/^\d+\.\s*실시방법$/)),
        content: this.splitDashList(valueAfter(/^\d+\.\s*주요내용$/)),
        sponsors: valueAfter(/^\d+\.\s*후원기관$/),
        confirmedDate: valueAfter(/^\d+\.\s*개최확정일$/),
        materialPostedAt: valueAfter(/^게재일시$/),
        parsedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`IR 개최 파싱 실패 (${rcept_no}): ${error}`);
      return null;
    }
  }

  /**
   * IR 개최 상세 정보를 LLM 입력용 텍스트 줄로 변환
   */
  private formatIrEventDetail(d: IrEventDetail): string[] {
    const lines = ['   📊 상세 (원문 파싱):'];

    if (d.startDate) {
      const period = d.endDate && d.endDate !== d.startDate ? `${d.startDate} ~ ${d.endDate}` : d.startDate;
      const time =
        d.startTime || d.endTime ? ` ${d.startTime || '?'}~${d.endTime || '?'}` : '';
      // 행사일이 오늘 이전이면 개최 완료, 아니면 개최 예정
      const eventEnd = new Date(`${d.endDate || d.startDate}T23:59:59`);
      const status = Number.isNaN(eventEnd.getTime())
        ? ''
        : eventEnd.getTime() < Date.now()
          ? ' (개최 완료)'
          : ' (개최 예정)';
      lines.push(`      • 행사 일시: ${period}${time}${status}`);
    }
    if (d.place) lines.push(`      • 장소: ${d.place}`);
    if (d.audience) lines.push(`      • 대상자: ${d.audience}`);
    if (d.purpose) lines.push(`      • 실시목적: ${d.purpose}`);
    if (d.method) lines.push(`      • 실시방법: ${d.method}`);
    if (d.content) lines.push(`      • 주요내용: ${d.content}`);
    if (d.sponsors) lines.push(`      • 후원기관: ${d.sponsors}`);
    return lines;
  }

  /**
   * 정기보고서(사업/반기/분기)의 재무 요약을 DART 단일회사 주요계정 API 로 조회한다.
   * 제목에서 기간을 못 읽거나 API 가 데이터를 주지 않으면 null (→ 일반 설명으로 대체).
   */
  async getFinancialSummaryLines(
    corp_code: string,
    reportName: string,
  ): Promise<string[] | null> {
    const period = parseReportPeriod(reportName);
    if (!period) return null;

    try {
      const params = new URLSearchParams({
        crtfc_key: this.apiKey,
        corp_code,
        bsns_year: period.year,
        reprt_code: period.reprtCode,
      });
      const { data } = await firstValueFrom(
        this.httpService.get<{
          status: string;
          message: string;
          list?: DartFinancialItem[];
        }>(`${this.baseUrl}/fnlttSinglAcnt.json?${params.toString()}`, { timeout: 10_000 }),
      );

      if (data.status !== '000' || !data.list?.length) {
        this.logger.warn(
          `재무제표 API 데이터 없음: ${reportName} (${corp_code}) status=${data.status} ${data.message}`,
        );
        return null;
      }

      const summary = parseFinancialSummary(data.list, period);
      return summary ? formatFinancialSummary(summary) : null;
    } catch (error) {
      this.logger.error(`재무제표 API 조회 실패 (${corp_code}): ${error}`);
      return null;
    }
  }

  /**
   * 원문을 내려받아 파서(순수 함수)로 읽고 LLM 입력용 줄로 변환한다.
   * 파싱 결과가 없거나 실패하면 null 을 반환해 호출한 쪽이 일반 설명으로 대체하게 한다.
   */
  private async detailLinesFrom<T>(
    rcept_no: string,
    parse: (xml: string, rcept_no: string) => T | null,
    format: (detail: T) => string[],
  ): Promise<string[] | null> {
    try {
      const xml = await this.getDisclosureDocument(rcept_no);
      const detail = parse(xml, rcept_no);
      if (!detail) {
        this.logger.warn(`원문에서 상세 정보를 찾을 수 없음: ${rcept_no}`);
        return null;
      }
      return format(detail);
    } catch (error) {
      this.logger.error(`원문 파싱 실패 (${rcept_no}): ${error}`);
      return null;
    }
  }

  /**
   * 거래소 자유서식 공시용: 말단 td 의 텍스트를 문서 순서대로 펼친 목록
   * (빈 칸도 유지해야 값이 비었을 때 다음 라벨이 값으로 잘못 읽히지 않는다)
   */
  private flatCells(xml: string): string[] {
    const $ = cheerio.load(xml, { xmlMode: true });
    return $('td')
      .filter((_, el) => $(el).find('td').length === 0)
      .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
      .get();
  }

  /**
   * 펼친 칸 목록에서 라벨 칸을 찾아 그 뒤 offset 번째 칸 텍스트를 반환 (없으면 빈 문자열)
   */
  private cellAfter(cells: string[], label: RegExp, offset = 1): string {
    const i = cells.findIndex((c) => label.test(c));
    return i >= 0 ? (cells[i + offset] ?? '') : '';
  }

  /**
   * 금전대여 결정 공시 원문 파싱
   * @param rcept_no 접수번호
   * @returns 금전대여 상세 정보 (실패 시 null)
   */
  async parseMoneyLendingDetail(rcept_no: string): Promise<MoneyLendingDetail | null> {
    try {
      const cells = this.flatCells(await this.getDisclosureDocument(rcept_no));
      const after = (label: RegExp, offset = 1): string => this.cellAfter(cells, label, offset);

      const amount = this.toNumber(after(/^대여금액\s*\(원\)$/));
      const counterparty = after(/^1?\.?\s*성명\s*\(법인명\)$/);
      if (amount === null && !counterparty) {
        this.logger.warn(`금전대여 정보를 찾을 수 없음: ${rcept_no}`);
        return null;
      }

      return {
        rcept_no,
        counterparty,
        relation: after(/^\(회사와의 관계\)$/),
        amount,
        equity: this.toNumber(after(/^-?\s*자기자본\s*\(원\)$/)),
        equityRatio: this.toNumber(after(/^-?\s*자기자본\s*대비\s*\(%\)$/)),
        interestRate: this.toNumber(after(/^이율\s*\(%\)$/)),
        periodStart: after(/^시작일$/),
        periodEnd: after(/^종료일$/),
        purpose: after(/^\d+\.\s*금전대여\s*목적$/),
        totalBalance: this.toNumber(after(/^\d+\.\s*금전대여\s*총잔액\s*\(원\)$/)),
        decisionDate: after(/^\d+\.\s*이사회결의일/),
        counterpartyFiscalYear: after(/^해당\s*사업연도$/),
        counterpartyRevenue: this.toNumber(after(/^매출액$/)),
        counterpartyNetIncome: this.toNumber(after(/^당기순손익$/)),
        remarks: after(/^\d+\.\s*기타\s*투자판단에\s*참고할\s*사항$/),
        parsedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`금전대여 파싱 실패 (${rcept_no}): ${error}`);
      return null;
    }
  }

  /**
   * 금전대여 상세 정보를 LLM 입력용 텍스트 줄로 변환
   */
  private formatMoneyLendingDetail(d: MoneyLendingDetail): string[] {
    const won = (n: number | null): string =>
      n === null ? '정보 없음' : `${n.toLocaleString('ko-KR')}원 (약 ${this.toEok(n)}억원)`;

    const lines = ['   📊 상세 (원문 파싱):'];
    lines.push(
      `      • 대여 상대방: ${d.counterparty || '정보 없음'}${d.relation ? ` (${d.relation})` : ''}`,
    );
    lines.push(
      `      • 대여금액: ${won(d.amount)}${d.equityRatio !== null ? `, 자기자본 대비 ${d.equityRatio}%` : ''}`,
    );
    if (d.equity !== null) lines.push(`      • 자기자본: ${won(d.equity)}`);
    if (d.interestRate !== null) lines.push(`      • 이율: ${d.interestRate}%`);
    if (d.periodStart || d.periodEnd) {
      lines.push(`      • 대여기간: ${d.periodStart || '?'} ~ ${d.periodEnd || '?'}`);
    }
    if (d.purpose) lines.push(`      • 대여 목적: ${d.purpose}`);
    if (d.totalBalance !== null) lines.push(`      • 금전대여 총잔액(본 건 포함): ${won(d.totalBalance)}`);
    if (d.counterpartyRevenue !== null || d.counterpartyNetIncome !== null) {
      const fmt = (n: number | null): string =>
        n === null ? '정보 없음' : `${n.toLocaleString('ko-KR')}백만원`;
      lines.push(
        `      • 상대방 재무(${d.counterpartyFiscalYear || '최근 사업연도'}): 매출액 ${fmt(d.counterpartyRevenue)}, 당기순손익 ${fmt(d.counterpartyNetIncome)}`,
      );
    }
    if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
    if (d.remarks) {
      const short = d.remarks.length > 300 ? `${d.remarks.slice(0, 300)}…` : d.remarks;
      lines.push(`      • 참고사항: ${short}`);
    }
    return lines;
  }

  /**
   * 단기차입금 증가 결정 공시 원문 파싱
   * @param rcept_no 접수번호
   * @returns 단기차입금 상세 정보 (실패 시 null)
   */
  async parseShortTermBorrowingDetail(
    rcept_no: string,
  ): Promise<ShortTermBorrowingDetail | null> {
    try {
      const cells = this.flatCells(await this.getDisclosureDocument(rcept_no));
      const after = (label: RegExp, offset = 1): string => this.cellAfter(cells, label, offset);

      const amount = this.toNumber(after(/^차입금액\s*\(원\)$/));
      if (amount === null) {
        this.logger.warn(`단기차입금 정보를 찾을 수 없음: ${rcept_no}`);
        return null;
      }

      const totalLabel = /^-?\s*단기차입금\s*합계\s*\(원\)$/;
      return {
        rcept_no,
        amount,
        equity: this.toNumber(after(/^자기자본\s*\(원\)$/)),
        equityRatio: this.toNumber(after(/^자기자본\s*대비\s*\(%\)$/)),
        totalBefore: this.toNumber(after(totalLabel, 1)),
        totalAfter: this.toNumber(after(totalLabel, 2)),
        purpose: after(/^\d+\.\s*차입목적$/),
        form: after(/^\d+\.\s*차입형태$/),
        decisionDate: after(/^\d+\.\s*이사회결의일/),
        remarks: after(/^\d+\.\s*기타\s*투자판단에\s*참고할\s*사항$/),
        parsedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`단기차입금 파싱 실패 (${rcept_no}): ${error}`);
      return null;
    }
  }

  /**
   * 단기차입금 상세 정보를 LLM 입력용 텍스트 줄로 변환
   */
  private formatShortTermBorrowingDetail(d: ShortTermBorrowingDetail): string[] {
    const won = (n: number | null): string =>
      n === null ? '정보 없음' : `${n.toLocaleString('ko-KR')}원 (약 ${this.toEok(n)}억원)`;

    const lines = ['   📊 상세 (원문 파싱):'];
    lines.push(
      `      • 차입금액: ${won(d.amount)}${d.equityRatio !== null ? `, 자기자본 대비 ${d.equityRatio}%` : ''}`,
    );
    if (d.equity !== null) lines.push(`      • 자기자본: ${won(d.equity)}`);
    if (d.totalBefore !== null || d.totalAfter !== null) {
      lines.push(`      • 단기차입금 합계: ${won(d.totalBefore)} → ${won(d.totalAfter)}`);
    }
    if (d.purpose) lines.push(`      • 차입 목적: ${d.purpose}`);
    if (d.form) lines.push(`      • 차입 형태: ${d.form}`);
    if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
    return lines;
  }

  /**
   * 원 단위 금액을 억원 단위 문자열로 (소수 첫째 자리, 천 단위 구분)
   */
  private toEok(won: number): string {
    return (won / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  }

  /**
   * "- A (1주)- B (2주)" 처럼 줄바꿈 없이 붙어 있는 대시 목록을 " / " 로 분리
   */
  private splitDashList(text: string): string {
    return text
      .split(/(?:^|\s*)-\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' / ');
  }

  /**
   * "8,252,643" / "5.02" / "-" 같은 문자열을 숫자로 변환 (값이 없으면 null)
   */
  private toNumber(text: string): number | null {
    const cleaned = text.replace(/[,\s%]/g, '');
    if (!cleaned || cleaned === '-') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
}

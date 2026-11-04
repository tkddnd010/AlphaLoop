import type {
  BonusIssueDetail,
  CapitalReductionDetail,
  ConversionPriceAdjustDetail,
  DividendDetail,
  EmbezzlementDetail,
  FacilityInvestmentDetail,
  GuaranteeDetail,
  LargestShareholderDetail,
  LawsuitDetail,
  ManagementMatterDetail,
  OtherCorpStockDetail,
  OwnCbBuybackDetail,
  PreliminaryEarningsDetail,
  RehabilitationDetail,
  RumorClarificationDetail,
  SecuritiesIssueResultDetail,
  ShareCancelDetail,
  ShareConsolidationDetail,
  SplitDetail,
  SupplyContractCancelDetail,
  TangibleAssetDetail,
  TreasuryTrustDetail,
} from '../interfaces/dart.interface.js';
import {
  acodeReader,
  cellAfterFrom,
  cellAfterLast,
  flatCells,
  formatShares,
  formatWon,
  meaningful,
  toNumber,
  truncate,
} from './xml-helpers.js';

/**
 * 나머지 공시 유형 파서 (주요사항보고 ACODE + 거래소 HTML).
 * 값을 못 찾으면 null → 호출한 쪽이 일반 설명으로 대체한다.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100;
const header = (): string[] => ['   📊 상세 (원문 파싱):'];
const afterOf = (cells: string[]) => (label: RegExp) => cellAfterLast(cells, label);

function moneyLine(label: string, n: number | null, extra = ''): string {
  return `      • ${label}: ${formatWon(n)}${extra}`;
}

// ───────────────────────── 감자 결정 ─────────────────────────

export function parseCapitalReduction(xml: string, rcept_no: string): CapitalReductionDetail | null {
  const r = acodeReader(xml);
  const sharesBefore = toNumber(r.code('BFR_CST_CNT'));
  const sharesAfter = toNumber(r.code('AFT_CST_CNT'));
  if (sharesBefore === null && sharesAfter === null) return null;
  return {
    rcept_no,
    sharesBefore,
    sharesAfter,
    reducedShares: toNumber(r.code('CST_CNT')),
    reductionRatio: toNumber(r.code('ROC_CST_RT')),
    capitalBefore: toNumber(r.code('ROC_BAMT')),
    capitalAfter: toNumber(r.code('ROC_AAMT')),
    faceValue: toNumber(r.code('FVAL')),
    method: meaningful(r.code('ROC_MTH')),
    reason: meaningful(r.code('ROC_RSN')),
    reductionDate: meaningful(r.unit('ROC_DT')),
    decisionDate: meaningful(r.unit('DRC_DT')),
    parsedAt: new Date(),
  };
}

export function formatCapitalReduction(d: CapitalReductionDetail): string[] {
  const lines = header();
  lines.push(
    `      • 감자: ${formatShares(d.sharesBefore)} → ${formatShares(d.sharesAfter)}${
      d.reductionRatio !== null ? ` (감자비율 ${d.reductionRatio}%)` : ''
    }`,
  );
  if (d.capitalBefore !== null || d.capitalAfter !== null) {
    lines.push(`      • 자본금: ${formatWon(d.capitalBefore)} → ${formatWon(d.capitalAfter)}`);
  }
  if (d.reason) lines.push(`      • 감자 사유: ${truncate(d.reason, 150)}`);
  if (d.method) lines.push(`      • 감자 방법: ${truncate(d.method, 150)}`);
  if (d.reductionDate) lines.push(`      • 감자 기준일: ${d.reductionDate}`);
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  return lines;
}

// ───────────────────────── 타법인주식 양수/양도 (ACODE) ─────────────────────────

export function parseOtherCorpTransfer(
  xml: string,
  rcept_no: string,
): OtherCorpStockDetail | null {
  const r = acodeReader(xml);
  const isAcquire = !!r.code('AC_AMT') || !!r.code('AC_STK_CNT');
  const isDispose = !!r.code('TR_AMT') || !!r.code('TR_STK_CNT');
  if (!isAcquire && !isDispose) return null;
  const kind: OtherCorpStockDetail['kind'] = isAcquire ? '양수' : '양도';
  return {
    rcept_no,
    kind,
    company: meaningful(r.code('PC_NM')),
    relation: '',
    shares: toNumber(r.code(isAcquire ? 'AC_STK_CNT' : 'TR_STK_CNT')),
    amount: toNumber(r.code(isAcquire ? 'AC_AMT' : 'TR_AMT')),
    equity: toNumber(r.code('CRP_EQT')),
    equityRatio: toNumber(r.code('EQT_RT')),
    assetTotal: toNumber(r.code('CRP_ASST')),
    assetRatio: toNumber(r.code('ASST_RT')),
    afterShares: toNumber(r.code('AFT_AC_STK_CNT')),
    afterRatio: toNumber(r.code('AFT_AC_SHR_RT')),
    purpose: meaningful(r.code(isAcquire ? 'AC_PPS' : 'TR_PPS')),
    method: '',
    counterparty: meaningful(r.code('OTH_NM')),
    scheduledDate: '',
    decisionDate: '',
    parsedAt: new Date(),
  };
}

// ───────────────────────── 타법인주식 취득/처분 (거래소 HTML) ─────────────────────────

export function parseOtherCorpTrade(xml: string, rcept_no: string): OtherCorpStockDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const isAcquire = toNumber(after(/^취득금액\s*\(원\)$/)) !== null || toNumber(after(/^취득주식수\s*\(주\)$/)) !== null;
  const isDispose = toNumber(after(/^처분금액\s*\(원\)$/)) !== null || toNumber(after(/^처분주식수\s*\(주\)$/)) !== null;
  if (!isAcquire && !isDispose) return null;
  const kind: OtherCorpStockDetail['kind'] = isAcquire ? '취득' : '처분';
  return {
    rcept_no,
    kind,
    company: meaningful(after(/^회사명/)) || meaningful(after(/^회사명\(국적\)$/)),
    relation: meaningful(after(/^회사와\s*관계$/)),
    shares: toNumber(after(isAcquire ? /^취득주식수\s*\(주\)$/ : /^처분주식수\s*\(주\)$/)),
    amount: toNumber(after(isAcquire ? /^취득금액\s*\(원\)$/ : /^처분금액\s*\(원\)$/)),
    equity: toNumber(after(/^자기자본\s*\(원\)$/)),
    equityRatio: toNumber(after(/^자기자본\s*대비\s*\(%\)$/)),
    assetTotal: null,
    assetRatio: null,
    afterShares: toNumber(after(/^소유주식수\s*\(주\)$/)),
    afterRatio: toNumber(after(/^지분비율\s*\(%\)$/)),
    purpose: meaningful(after(isAcquire ? /^\d+\.\s*취득목적$/ : /^\d+\.\s*처분목적$/)),
    method: meaningful(after(/^\d+\.\s*취득방법$/)),
    counterparty: '',
    scheduledDate: meaningful(after(isAcquire ? /^\d+\.\s*취득예정일자$/ : /^\d+\.\s*처분예정일자$/)),
    decisionDate: meaningful(after(/^\d+\.\s*이사회결의일/)),
    parsedAt: new Date(),
  };
}

export function formatOtherCorpStock(d: OtherCorpStockDetail): string[] {
  const lines = header();
  if (d.company) {
    lines.push(`      • 대상 회사: ${d.company}${d.relation ? ` (${d.relation})` : ''}`);
  }
  const extra = [
    d.equityRatio !== null ? `자기자본 대비 ${d.equityRatio}%` : '',
    d.assetRatio !== null ? `자산총액 대비 ${d.assetRatio}%` : '',
  ]
    .filter(Boolean)
    .join(', ');
  lines.push(
    `      • ${d.kind}: ${formatShares(d.shares)}, ${formatWon(d.amount)}${extra ? ` (${extra})` : ''}`,
  );
  if (d.afterShares !== null || d.afterRatio !== null) {
    lines.push(
      `      • ${d.kind} 후 지분: ${formatShares(d.afterShares)}${
        d.afterRatio !== null ? ` (${d.afterRatio}%)` : ''
      }`,
    );
  }
  if (d.purpose) lines.push(`      • 목적: ${truncate(d.purpose, 150)}`);
  if (d.method) lines.push(`      • 방법: ${d.method}`);
  if (d.counterparty) lines.push(`      • 상대방: ${truncate(d.counterparty, 80)}`);
  if (d.scheduledDate) lines.push(`      • 예정일: ${d.scheduledDate}`);
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  return lines;
}

// ───────────────────────── 채무보증 / 담보제공 ─────────────────────────

export function parseDebtGuarantee(xml: string, rcept_no: string): GuaranteeDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const guaranteeAmount = toNumber(after(/^채무보증금액\s*\(원\)$/));
  if (guaranteeAmount === null) return null;
  return {
    rcept_no,
    kind: '채무보증',
    debtor: meaningful(after(/^\d+\.\s*채무자$/)),
    relation: meaningful(after(/회사와의\s*관계$/)),
    creditor: meaningful(after(/^\d+\.\s*채권자$/)),
    debtAmount: toNumber(after(/^채무\(차입\)금액\s*\(원\)$/)),
    guaranteeAmount,
    equity: toNumber(after(/^자기자본\s*\(원\)$/)),
    equityRatio: toNumber(after(/^자기자본대비\s*\(%\)$/)) ?? toNumber(after(/^자기자본\s*대비\s*\(%\)$/)),
    totalBalance: toNumber(after(/^\d+\.\s*채무보증\s*총\s*잔액\s*\(원\)$/)),
    periodStart: meaningful(after(/^시작일$/)),
    periodEnd: meaningful(after(/^종료일$/)),
    collateral: '',
    decisionDate: meaningful(after(/^\d+\.\s*이사회결의일/)),
    remarks: meaningful(after(/^\d+\.\s*기타\s*투자판단/)),
    parsedAt: new Date(),
  };
}

export function parseCollateralProvision(xml: string, rcept_no: string): GuaranteeDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const guaranteeAmount = toNumber(after(/^담보설정금액\s*\(원\)$/));
  if (guaranteeAmount === null) return null;
  return {
    rcept_no,
    kind: '담보제공',
    debtor: meaningful(after(/^\d+\.\s*채무자$/)),
    relation: meaningful(after(/회사와의\s*관계$/)),
    creditor: meaningful(after(/^\d+\.\s*채권자$/)),
    debtAmount: toNumber(after(/^채무\(차입\)금액\s*\(원\)$/)),
    guaranteeAmount,
    equity: toNumber(after(/^자기자본\s*\(원\)$/)),
    equityRatio: toNumber(after(/^자기자본대비\s*\(%\)$/)) ?? toNumber(after(/^자기자본\s*대비\s*\(%\)$/)),
    totalBalance: toNumber(after(/^\d+\.\s*담보제공\s*총\s*잔액\s*\(원\)$/)),
    periodStart: meaningful(after(/^시작일$/)),
    periodEnd: meaningful(after(/^종료일$/)),
    collateral: meaningful(after(/^담보제공재산$/)),
    decisionDate: meaningful(after(/^\d+\.\s*이사회결의일/)),
    remarks: meaningful(after(/^\d+\.\s*기타\s*투자판단/)),
    parsedAt: new Date(),
  };
}

export function formatGuarantee(d: GuaranteeDetail): string[] {
  const lines = header();
  if (d.debtor) lines.push(`      • 채무자: ${d.debtor}${d.relation ? ` (${d.relation})` : ''}`);
  if (d.creditor) lines.push(`      • 채권자: ${d.creditor}`);
  lines.push(
    moneyLine(d.kind === '채무보증' ? '보증금액' : '담보설정금액', d.guaranteeAmount, d.equityRatio !== null ? `, 자기자본 대비 ${d.equityRatio}%` : ''),
  );
  if (d.debtAmount !== null) lines.push(moneyLine('채무(차입)금액', d.debtAmount));
  if (d.totalBalance !== null) lines.push(moneyLine(`${d.kind} 총잔액`, d.totalBalance));
  if (d.collateral) lines.push(`      • 담보재산: ${d.collateral}`);
  if (d.periodStart || d.periodEnd) {
    lines.push(`      • 기간: ${d.periodStart || '?'} ~ ${d.periodEnd || '?'}`);
  }
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  if (d.remarks) lines.push(`      • 참고사항: ${truncate(d.remarks, 180)}`);
  return lines;
}

// ───────────────────────── 주식소각 ─────────────────────────

export function parseShareCancel(xml: string, rcept_no: string): ShareCancelDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  // "보통주식(주)"가 소각 수량과 발행주식총수에 모두 있어, 첫 칸=소각 수량 / 발행주식총수 이후=총수로 읽는다
  const shares = toNumber(cellAfterFrom(cells, 0, /^보통주식\s*\(주\)$/));
  const amount = toNumber(after(/^\d+\.\s*소각예정금액\s*\(원\)$/));
  if (shares === null && amount === null) return null;
  const issuedIdx = cells.findIndex((c) => c.includes('발행주식총수'));
  const issued = toNumber(cellAfterFrom(cells, issuedIdx >= 0 ? issuedIdx : 0, /^보통주식\s*\(주\)$/));
  return {
    rcept_no,
    shares,
    issuedShares: issued,
    ratioOfIssued: shares !== null && issued ? round2((shares / issued) * 100) : null,
    amount,
    method: meaningful(after(/^\d+\.\s*소각할\s*주식의\s*취득방법$/)),
    cancelDate: meaningful(after(/^\d+\.\s*소각\s*예정일$/)),
    decisionDate: meaningful(after(/^\d+\.\s*이사회결의일$/)),
    remarks: meaningful(after(/^\d+\.\s*기타\s*투자판단/)),
    parsedAt: new Date(),
  };
}

export function formatShareCancel(d: ShareCancelDetail): string[] {
  const lines = header();
  lines.push(
    `      • 소각 주식: ${formatShares(d.shares)}${
      d.ratioOfIssued !== null ? ` (발행주식 대비 ${d.ratioOfIssued}%)` : ''
    }, 예정금액 ${formatWon(d.amount)}`,
  );
  if (d.method) lines.push(`      • 취득방법: ${d.method}`);
  if (d.cancelDate) lines.push(`      • 소각 예정일: ${d.cancelDate}`);
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  if (d.remarks) lines.push(`      • 참고사항: ${truncate(d.remarks, 150)}`);
  return lines;
}

// ───────────────────────── 최대주주 변경 / 양수도 / 담보 ─────────────────────────

export function parseLargestShareholderChange(
  xml: string,
  rcept_no: string,
): LargestShareholderDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const afterIdx = cells.findIndex((c) => c === '변경후' || c === '변경 후');
  const prevHolder = meaningful(after(/^최대주주등$/));
  const nextHolder =
    afterIdx >= 0 ? meaningful(cellAfterFrom(cells, afterIdx, /^최대주주등$/)) : '';
  if (!prevHolder && !nextHolder) return null;
  return {
    rcept_no,
    kind: '변경',
    prevHolder,
    prevShares: toNumber(after(/^소유주식수\s*\(주\)$/)),
    prevRatio: toNumber(after(/^소유비율\s*\(%\)$/)),
    nextHolder,
    nextShares: afterIdx >= 0 ? toNumber(cellAfterFrom(cells, afterIdx, /^소유주식수\s*\(주\)$/)) : null,
    nextRatio: afterIdx >= 0 ? toNumber(cellAfterFrom(cells, afterIdx, /^소유비율\s*\(%\)$/)) : null,
    reason: meaningful(after(/^\d+\.\s*변경사유$/)),
    purpose: meaningful(after(/^\d+\.\s*지분인수목적$/)),
    dealShares: null,
    dealAmount: null,
    changeDate: meaningful(after(/^\d+\.\s*변경일자$/)),
    remarks: meaningful(after(/^\d+\.\s*기타\s*투자판단/)),
    parsedAt: new Date(),
  };
}

export function parseLargestShareholderDeal(
  xml: string,
  rcept_no: string,
): LargestShareholderDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const dealAmount = toNumber(after(/^양수도\s*대금\s*\(원\)$/));
  const nextHolder = meaningful(after(/^\d+\.\s*변경예정\s*최대주주$/)) || meaningful(after(/^-양수인$/));
  if (dealAmount === null && !nextHolder) return null;
  return {
    rcept_no,
    kind: '양수도계약',
    prevHolder: meaningful(after(/^-양도인$/)),
    prevShares: null,
    prevRatio: null,
    nextHolder,
    nextShares: toNumber(after(/^-예정\s*소유주식수\s*\(주\)$/)),
    nextRatio: toNumber(after(/^-예정\s*소유비율\s*\(%\)$/)),
    reason: '',
    purpose: '',
    dealShares: toNumber(after(/^양수도\s*주식수\s*\(주\)$/)),
    dealAmount,
    changeDate: meaningful(after(/^-변경\s*예정일자$/)) || meaningful(after(/^\d+\.\s*계약일자$/)),
    remarks: meaningful(after(/^\d+\.\s*기타\s*투자판단/)),
    parsedAt: new Date(),
  };
}

export function parseLargestShareholderPledge(
  xml: string,
  rcept_no: string,
): LargestShareholderDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const pledged = toNumber(after(/^누적\s*담보제공\s*주식\s*총수\s*\(주\)$/));
  const holder = meaningful(after(/^-?\s*명칭\(성명/));
  if (pledged === null && !holder) return null;
  const execIdx = cells.findLastIndex((c) => c.includes('담보권 전부'));
  const nowIdx = cells.findLastIndex((c) => c.includes('공시일 현재'));
  return {
    rcept_no,
    kind: '담보제공계약',
    prevHolder: holder,
    prevShares: nowIdx >= 0 ? toNumber(cellAfterFrom(cells, nowIdx, /^소유\s*주식\s*수\s*\(주\)$/)) : null,
    prevRatio: nowIdx >= 0 ? toNumber(cellAfterFrom(cells, nowIdx, /^지분율\s*\(%\)$/)) : null,
    nextHolder: holder,
    nextShares: execIdx >= 0 ? toNumber(cellAfterFrom(cells, execIdx, /^소유\s*주식\s*수\s*\(주\)$/)) : null,
    nextRatio: execIdx >= 0 ? toNumber(cellAfterFrom(cells, execIdx, /^지분율\s*\(%\)$/)) : null,
    reason: '최대주주 보유주식 담보 제공',
    purpose: '',
    dealShares: pledged,
    dealAmount: toNumber(after(/^\d+\.\s*담보설정금액\s*총액\s*\(원\)$/)),
    changeDate: meaningful(after(/^\d+\.\s*담보권\s*설정계약\s*체결일/)),
    remarks: meaningful(after(/^\d+\.\s*기타\s*투자판단/)),
    parsedAt: new Date(),
  };
}

export function formatLargestShareholder(d: LargestShareholderDetail): string[] {
  const lines = header();
  lines.push(`      • 유형: 최대주주 ${d.kind}`);
  if (d.prevHolder || d.nextHolder) {
    lines.push(
      `      • 최대주주: ${d.prevHolder || '?'}${
        d.prevRatio !== null ? ` (${d.prevRatio}%)` : ''
      } → ${d.nextHolder || '?'}${d.nextRatio !== null ? ` (${d.nextRatio}%)` : ''}`,
    );
  }
  if (d.dealShares !== null || d.dealAmount !== null) {
    lines.push(
      `      • 계약: ${formatShares(d.dealShares)}, ${formatWon(d.dealAmount)}`,
    );
  }
  if (d.reason) lines.push(`      • 사유: ${truncate(d.reason, 150)}`);
  if (d.purpose) lines.push(`      • 인수목적: ${d.purpose}`);
  if (d.changeDate) lines.push(`      • 일자: ${d.changeDate}`);
  if (d.remarks) lines.push(`      • 참고사항: ${truncate(d.remarks, 150)}`);
  return lines;
}

// ───────────────────────── 소송 ─────────────────────────

export function parseLawsuitMajor(xml: string, rcept_no: string): LawsuitDetail | null {
  const r = acodeReader(xml);
  const caseName = meaningful(r.code('SUE_NM'));
  if (!caseName) return null;
  return {
    rcept_no,
    kind: '제기',
    caseName,
    party: meaningful(r.code('APP_NM')),
    court: meaningful(r.code('COURT')),
    content: meaningful(r.code('RQST_CONT')),
    date: '',
    remarks: meaningful(r.code('FTR_SCHD')),
    parsedAt: new Date(),
  };
}

export function parseLawsuitExchange(xml: string, rcept_no: string): LawsuitDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const caseName = meaningful(after(/^\d+\.\s*사건의\s*명칭$/));
  const content =
    meaningful(after(/^\d+\.\s*판결ㆍ결정내용$/)) ||
    meaningful(after(/^\d+\.\s*판결.결정내용$/));
  if (!caseName && !content) return null;
  const isJudgment = !!content;
  return {
    rcept_no,
    kind: isJudgment ? '판결' : '제기',
    caseName: caseName || meaningful(after(/사건번호$/)),
    party: meaningful(after(/^\d+\.\s*원고ㆍ신청인$/)) || meaningful(after(/^\d+\.\s*원고.신청인$/)),
    court: meaningful(after(/^\d+\.\s*관할법원$/)),
    content: content || meaningful(after(/^\d+\.\s*청구내용$/)),
    date: meaningful(after(/^\d+\.\s*판결ㆍ결정일자$/)) || meaningful(after(/^\d+\.\s*확인일자$/)),
    remarks: meaningful(after(/^\d+\.\s*기타\s*투자판단/)),
    parsedAt: new Date(),
  };
}

export function formatLawsuit(d: LawsuitDetail): string[] {
  const lines = header();
  lines.push(`      • 구분: 소송 ${d.kind}`);
  if (d.caseName) lines.push(`      • 사건: ${truncate(d.caseName, 120)}`);
  if (d.party) lines.push(`      • 상대/신청인: ${d.party}`);
  if (d.court) lines.push(`      • 관할법원: ${d.court}`);
  if (d.content) lines.push(`      • 내용: ${truncate(d.content, 200)}`);
  if (d.date) lines.push(`      • 일자: ${d.date}`);
  if (d.remarks) lines.push(`      • 향후 일정: ${truncate(d.remarks, 150)}`);
  return lines;
}

// ───────────────────────── 배당 ─────────────────────────

export function parseDividend(xml: string, rcept_no: string): DividendDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const perShare = toNumber(after(/^보통주식$/));
  const totalAmount = toNumber(after(/^\d+\.\s*배당금총액\s*\(원\)$/));
  if (perShare === null && totalAmount === null) return null;
  const yieldIdx = cells.findIndex((c) => /시가배당률/.test(c));
  return {
    rcept_no,
    category: meaningful(after(/^\d+\.\s*배당구분$/)),
    type: meaningful(after(/^\d+\.\s*배당종류$/)),
    perShare,
    yieldRate: yieldIdx >= 0 ? toNumber(cellAfterFrom(cells, yieldIdx, /^보통주식$/)) : null,
    totalAmount,
    recordDate: meaningful(after(/^\d+\.\s*배당기준일$/)),
    payDate: meaningful(after(/^\d+\.\s*배당금지급/)),
    decisionDate: meaningful(after(/^\d+\.\s*이사회결의일/)),
    parsedAt: new Date(),
  };
}

export function formatDividend(d: DividendDetail): string[] {
  const lines = header();
  lines.push(`      • 배당: ${[d.category, d.type].filter(Boolean).join(' / ') || '현금·현물배당'}`);
  lines.push(
    `      • 1주당 ${d.perShare !== null ? `${d.perShare.toLocaleString('ko-KR')}원` : '정보 없음'}${
      d.yieldRate !== null ? ` (시가배당률 ${d.yieldRate}%)` : ''
    }, 총액 ${formatWon(d.totalAmount)}`,
  );
  if (d.recordDate) lines.push(`      • 배당기준일: ${d.recordDate}`);
  if (d.payDate) lines.push(`      • 지급예정일: ${d.payDate}`);
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  return lines;
}

// ───────────────────────── 증권발행결과 ─────────────────────────

export function parseSecuritiesIssueResult(
  xml: string,
  rcept_no: string,
): SecuritiesIssueResultDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const actualAmount = toNumber(after(/^실제발행금액\s*\(원\)$/));
  const actualShares = toNumber(after(/^실제발행주식수\s*\(주\)$/));
  if (actualAmount === null && actualShares === null) return null;
  return {
    rcept_no,
    securityType: meaningful(after(/^\d+\.\s*증권의\s*종류$/)),
    method: meaningful(after(/^\d+\.\s*발행방법$/)),
    plannedShares: toNumber(after(/^발행예정주식수\s*\(주\)$/)),
    plannedAmount: toNumber(after(/^발행예정금액\s*\(원\)$/)),
    actualShares,
    actualAmount,
    paymentDate: meaningful(after(/^납입일$/)),
    remarks: meaningful(after(/^\d+\.\s*기타\s*투자판단/)),
    parsedAt: new Date(),
  };
}

export function formatSecuritiesIssueResult(d: SecuritiesIssueResultDetail): string[] {
  const lines = header();
  if (d.securityType || d.method) {
    lines.push(`      • 발행: ${[d.securityType, d.method].filter(Boolean).join(' / ')}`);
  }
  lines.push(
    `      • 실제 발행: ${formatShares(d.actualShares)}, ${formatWon(d.actualAmount)} (예정 ${formatShares(d.plannedShares)}, ${formatWon(d.plannedAmount)})`,
  );
  if (d.paymentDate) lines.push(`      • 납입일: ${d.paymentDate}`);
  if (d.remarks) lines.push(`      • 참고사항: ${truncate(d.remarks, 150)}`);
  return lines;
}

// ───────────────────────── 풍문 해명 / 투자판단 / 시설투자 ─────────────────────────

export function parseRumorClarification(
  xml: string,
  rcept_no: string,
): RumorClarificationDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const rumor = meaningful(after(/^\d+\.\s*풍문\s*또는\s*보도의\s*내용$/));
  const clarification = meaningful(after(/해명내용$/));
  if (!rumor && !clarification) return null;
  return {
    rcept_no,
    rumor,
    media: meaningful(after(/보도의\s*매체$/)),
    rumorDate: meaningful(after(/발생일자$/)),
    clarification,
    reDisclosureDate: meaningful(after(/^\d+\.\s*재공시예정일$/)),
    parsedAt: new Date(),
  };
}

export function formatRumorClarification(d: RumorClarificationDetail): string[] {
  const lines = header();
  if (d.rumor) lines.push(`      • 보도: ${truncate(d.rumor, 120)}${d.media ? ` (${d.media})` : ''}`);
  if (d.clarification) lines.push(`      • 해명: ${truncate(d.clarification, 220)}`);
  if (d.reDisclosureDate) lines.push(`      • 재공시예정일: ${d.reDisclosureDate}`);
  return lines;
}

export function parseManagementMatter(
  xml: string,
  rcept_no: string,
): ManagementMatterDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const title = meaningful(after(/^\d+\.\s*제목$/));
  const content = meaningful(after(/^\d+\.\s*주요내용$/));
  if (!title && !content) return null;
  return {
    rcept_no,
    title,
    content,
    confirmedDate: meaningful(after(/이사회결의일|사실확인일/)),
    parsedAt: new Date(),
  };
}

export function formatManagementMatter(d: ManagementMatterDetail): string[] {
  const lines = header();
  if (d.title) lines.push(`      • 제목: ${truncate(d.title, 120)}`);
  if (d.content) lines.push(`      • 내용: ${truncate(d.content, 250)}`);
  if (d.confirmedDate) lines.push(`      • 확인일: ${d.confirmedDate}`);
  return lines;
}

export function parseFacilityInvestment(
  xml: string,
  rcept_no: string,
): FacilityInvestmentDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const amount = toNumber(after(/^투자금액\s*\(원\)$/));
  if (amount === null) return null;
  return {
    rcept_no,
    category: meaningful(after(/^\d+\.\s*투자구분$/)),
    amount,
    equity: toNumber(after(/^자기자본\s*\(원\)$/)),
    equityRatio: toNumber(after(/^자기자본대비\s*\(%\)$/)) ?? toNumber(after(/^자기자본\s*대비\s*\(%\)$/)),
    purpose: meaningful(after(/^\d+\.\s*투자목적$/)),
    periodStart: meaningful(after(/^시작일$/)),
    periodEnd: meaningful(after(/^종료일$/)),
    decisionDate: meaningful(after(/^\d+\.\s*이사회결의일/)),
    parsedAt: new Date(),
  };
}

export function formatFacilityInvestment(d: FacilityInvestmentDetail): string[] {
  const lines = header();
  if (d.category) lines.push(`      • 투자구분: ${d.category}`);
  lines.push(
    moneyLine('투자금액', d.amount, d.equityRatio !== null ? `, 자기자본 대비 ${d.equityRatio}%` : ''),
  );
  if (d.purpose) lines.push(`      • 목적: ${truncate(d.purpose, 150)}`);
  if (d.periodStart || d.periodEnd) {
    lines.push(`      • 투자기간: ${d.periodStart || '?'} ~ ${d.periodEnd || '?'}`);
  }
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  return lines;
}

// ───────────────────────── 자기주식 신탁 체결/해지 ─────────────────────────

export function parseTreasuryTrustSign(xml: string, rcept_no: string): TreasuryTrustDetail | null {
  const r = acodeReader(xml);
  const amount = toNumber(r.code('SIG_PRC'));
  if (amount === null) return null;
  return {
    rcept_no,
    kind: '체결',
    amount,
    purpose: meaningful(r.code('SIG_PPS')),
    trustee: meaningful(r.code('SIG_ORG')),
    periodStart: meaningful(r.unit('SIG_BGN')),
    periodEnd: meaningful(r.unit('SIG_END')),
    heldBefore: toNumber(r.code('HLD_OSTK')),
    heldBeforeRatio: toNumber(r.code('HLD_OSTK_RT')),
    acquiredShares: toNumber(r.code('ACQS_PLN_OSTK')),
    decisionDate: meaningful(r.unit('DEC_DATE')),
    parsedAt: new Date(),
  };
}

export function parseTreasuryTrustCancel(xml: string, rcept_no: string): TreasuryTrustDetail | null {
  const r = acodeReader(xml);
  const amount = toNumber(r.code('CLN_PRC_PRE'));
  const acquired = toNumber(r.code('CNL_OSTK'));
  if (amount === null && acquired === null) return null;
  return {
    rcept_no,
    kind: '해지',
    amount,
    purpose: meaningful(r.code('CNL_PPS')),
    trustee: meaningful(r.code('CNL_ORG')),
    periodStart: meaningful(r.unit('CNL_BGN')),
    periodEnd: meaningful(r.unit('CNL_END')),
    heldBefore: toNumber(r.code('HLD_OSTK')),
    heldBeforeRatio: toNumber(r.code('HLD_OSTK_RT')),
    acquiredShares: acquired,
    decisionDate: meaningful(r.unit('DEC_DATE')),
    parsedAt: new Date(),
  };
}

export function formatTreasuryTrust(d: TreasuryTrustDetail): string[] {
  const lines = header();
  lines.push(`      • 자기주식 신탁계약 ${d.kind}: ${formatWon(d.amount)}`);
  if (d.trustee) lines.push(`      • 수탁자: ${d.trustee}`);
  if (d.purpose) lines.push(`      • 목적: ${d.purpose}`);
  if (d.periodStart || d.periodEnd) {
    lines.push(`      • 계약기간: ${d.periodStart || '?'} ~ ${d.periodEnd || '?'}`);
  }
  if (d.acquiredShares !== null) {
    lines.push(
      `      • ${d.kind === '체결' ? '취득 예정' : '신탁으로 취득한 주식'}: ${formatShares(d.acquiredShares)}`,
    );
  }
  if (d.heldBefore !== null) {
    lines.push(
      `      • 현재 자기주식: ${formatShares(d.heldBefore)}${
        d.heldBeforeRatio !== null ? ` (${d.heldBeforeRatio}%)` : ''
      }`,
    );
  }
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  return lines;
}

// ───────────────────────── 무상증자 ─────────────────────────

export function parseBonusIssue(xml: string, rcept_no: string): BonusIssueDetail | null {
  const r = acodeReader(xml);
  const newShares = toNumber(r.code('CST_CNT'));
  const preShares = toNumber(r.code('BFR_CST_CNT'));
  if (newShares === null && preShares === null) return null;
  return {
    rcept_no,
    newShares,
    preShares,
    ratio: toNumber(r.code('NEW_ASN_CST')),
    recordDate: meaningful(r.unit('ALL_BS_DT')),
    listingDate: meaningful(r.unit('LST_PLN_DT')),
    decisionDate: meaningful(r.unit('DRC_DT')),
    parsedAt: new Date(),
  };
}

export function formatBonusIssue(d: BonusIssueDetail): string[] {
  const lines = header();
  lines.push(
    `      • 무상증자: 신주 ${formatShares(d.newShares)} (증자 전 ${formatShares(d.preShares)}${
      d.ratio !== null ? `, 배정비율 ${d.ratio}:1` : ''
    })`,
  );
  if (d.recordDate) lines.push(`      • 신주배정 기준일: ${d.recordDate}`);
  if (d.listingDate) lines.push(`      • 상장예정일: ${d.listingDate}`);
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  return lines;
}

// ───────────────────────── 회사분할 ─────────────────────────

export function parseSplit(xml: string, rcept_no: string): SplitDetail | null {
  const r = acodeReader(xml);
  const method = meaningful(r.code('SPL_MTH'));
  const newName = meaningful(r.code('NEW_INC'));
  if (!method && !newName) return null;
  return {
    rcept_no,
    method,
    purpose: meaningful(r.code('SPL_RES')),
    survivingName: meaningful(r.code('SPL_INC')),
    newName,
    survivingAssets: toNumber(r.code('SPL_ASST')),
    newAssets: toNumber(r.code('NEW_ASST')),
    remarks: meaningful(r.code('SPL_EFT')) || meaningful(r.code('RPT_SBM')),
    parsedAt: new Date(),
  };
}

export function formatSplit(d: SplitDetail): string[] {
  const lines = header();
  if (d.method) lines.push(`      • 분할 방법: ${truncate(d.method, 160)}`);
  if (d.purpose) lines.push(`      • 분할 목적: ${truncate(d.purpose, 160)}`);
  if (d.survivingName || d.newName) {
    lines.push(`      • 존속 ${d.survivingName || '?'} / 신설 ${d.newName || '?'}`);
  }
  if (d.survivingAssets !== null || d.newAssets !== null) {
    lines.push(
      `      • 자산: 존속 ${formatWon(d.survivingAssets)}, 신설 ${formatWon(d.newAssets)}`,
    );
  }
  if (d.remarks) lines.push(`      • 참고: ${truncate(d.remarks, 160)}`);
  return lines;
}

// ───────────────────────── 유형자산 양수/양도/취득 ─────────────────────────

export function parseTangibleAssetMajor(
  xml: string,
  rcept_no: string,
): TangibleAssetDetail | null {
  const r = acodeReader(xml);
  const acquireAmt = toNumber(r.code('AC_AMT'));
  const transferAmt = toNumber(r.code('TR_AMT'));
  if (acquireAmt === null && transferAmt === null) return null;
  const kind: TangibleAssetDetail['kind'] = acquireAmt !== null ? '양수' : '양도';
  return {
    rcept_no,
    kind,
    assetName: meaningful(r.code('ACCT_NM')),
    amount: acquireAmt ?? transferAmt,
    assetTotal: toNumber(r.code('CRP_ASST')),
    assetRatio: toNumber(r.code('ASST_RT')),
    purpose: meaningful(r.code(kind === '양수' ? 'AC_PPS' : 'TR_PPS')),
    counterparty: meaningful(r.code('OTH_NM')),
    scheduledDate: '',
    decisionDate: '',
    parsedAt: new Date(),
  };
}

export function parseTangibleAssetAcquire(
  xml: string,
  rcept_no: string,
): TangibleAssetDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const amount = toNumber(after(/^취득금액\s*\(원\)$/));
  if (amount === null) return null;
  return {
    rcept_no,
    kind: '취득',
    assetName: meaningful(after(/^\d+\.\s*취득목적물$/)),
    amount,
    assetTotal: toNumber(after(/^자산총액\s*\(원\)$/)),
    assetRatio: toNumber(after(/^자산총액대비\s*\(%\)$/)),
    purpose: meaningful(after(/^\d+\.\s*취득목적$/)),
    counterparty: meaningful(after(/^\d+\.\s*거래상대방$/)),
    scheduledDate: meaningful(after(/^\d+\.\s*취득예정일자$/)),
    decisionDate: meaningful(after(/^\d+\.\s*이사회결의일/)),
    parsedAt: new Date(),
  };
}

export function formatTangibleAsset(d: TangibleAssetDetail): string[] {
  const lines = header();
  if (d.assetName) lines.push(`      • 대상 자산: ${truncate(d.assetName, 120)}`);
  lines.push(
    moneyLine(
      `${d.kind}금액`,
      d.amount,
      d.assetRatio !== null ? `, 자산총액 대비 ${d.assetRatio}%` : '',
    ),
  );
  if (d.purpose) lines.push(`      • 목적: ${truncate(d.purpose, 150)}`);
  if (d.counterparty) lines.push(`      • 상대방: ${d.counterparty}`);
  if (d.scheduledDate) lines.push(`      • 예정일: ${d.scheduledDate}`);
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  return lines;
}

// ───────────────────────── 공급계약 해지 / 전환가액 / 주식병합 ─────────────────────────

export function parseSupplyContractCancel(
  xml: string,
  rcept_no: string,
): SupplyContractCancelDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const amount = toNumber(after(/^해지금액\s*\(원\)$/));
  if (amount === null) return null;
  return {
    rcept_no,
    contractName: meaningful(after(/^-?\s*해지계약명$/)) || meaningful(after(/판매.공급계약\s*해지\s*구분$/)),
    amount,
    recentRevenue: toNumber(after(/^최근매출액\s*\(원\)$/)),
    revenueRatio: toNumber(after(/^매출액대비\s*\(%\)$/)),
    counterparty: meaningful(after(/^\d+\.\s*계약상대$/)),
    reason: meaningful(after(/^\d+\.\s*해지\s*주요사유$/)),
    cancelDate: meaningful(after(/^\d+\.\s*해지일자$/)),
    parsedAt: new Date(),
  };
}

export function formatSupplyContractCancel(d: SupplyContractCancelDetail): string[] {
  const lines = header();
  if (d.contractName) lines.push(`      • 해지 계약: ${d.contractName}`);
  lines.push(
    moneyLine(
      '해지금액',
      d.amount,
      d.revenueRatio !== null ? `, 최근 매출액 대비 ${d.revenueRatio}%` : '',
    ),
  );
  if (d.counterparty) lines.push(`      • 상대방: ${d.counterparty}`);
  if (d.reason) lines.push(`      • 해지 사유: ${truncate(d.reason, 150)}`);
  if (d.cancelDate) lines.push(`      • 해지일자: ${d.cancelDate}`);
  return lines;
}

export function parseConversionPriceAdjust(
  xml: string,
  rcept_no: string,
): ConversionPriceAdjustDetail | null {
  const cells = flatCells(xml);
  // 헤더 행(회차/상장여부/조정전/조정후) 다음에 값이 한 줄로 이어진다
  const priceHeader = cells.findIndex((c) => /^조정후\s*전환가액/.test(c));
  const shareHeader = cells.findIndex((c) => /^조정후\s*전환가능/.test(c));
  const priceBefore = priceHeader >= 0 ? toNumber(cells[priceHeader + 3] ?? '') : null;
  const priceAfter = priceHeader >= 0 ? toNumber(cells[priceHeader + 4] ?? '') : null;
  if (priceBefore === null && priceAfter === null) return null;

  const shareNums: number[] = [];
  if (shareHeader >= 0) {
    for (let i = shareHeader + 1; i < shareHeader + 8 && i < cells.length; i++) {
      const n = toNumber(cells[i]);
      if (n !== null) shareNums.push(n);
    }
  }

  return {
    rcept_no,
    round: priceHeader >= 0 ? meaningful(cells[priceHeader + 1] ?? '') : '',
    priceBefore,
    priceAfter,
    sharesBefore: shareNums.length >= 2 ? shareNums[shareNums.length - 2] : null,
    sharesAfter: shareNums.length >= 1 ? shareNums[shareNums.length - 1] : null,
    reason: meaningful(cellAfterLast(cells, /^\d+\.\s*조정사유$/)),
    applyDate: meaningful(cellAfterLast(cells, /^\d+\.\s*조정가액\s*적용일$/)),
    parsedAt: new Date(),
  };
}

export function formatConversionPriceAdjust(d: ConversionPriceAdjustDetail): string[] {
  const lines = header();
  lines.push(
    `      • 전환가액${d.round ? ` (${d.round}회차)` : ''}: ${
      d.priceBefore !== null ? `${d.priceBefore.toLocaleString('ko-KR')}원` : '?'
    } → ${d.priceAfter !== null ? `${d.priceAfter.toLocaleString('ko-KR')}원` : '?'}`,
  );
  if (d.sharesBefore !== null || d.sharesAfter !== null) {
    lines.push(
      `      • 전환가능 주식수: ${formatShares(d.sharesBefore)} → ${formatShares(d.sharesAfter)}`,
    );
  }
  if (d.reason) lines.push(`      • 조정사유: ${d.reason}`);
  if (d.applyDate) lines.push(`      • 적용일: ${d.applyDate}`);
  return lines;
}

export function parseShareConsolidation(
  xml: string,
  rcept_no: string,
): ShareConsolidationDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  // 병합전/병합후가 헤더 행이라, 값 칸은 라벨 다음 1칸=병합전, 2칸=병합후
  const sharesBefore = toNumber(after(/^보통주식\s*\(주\)$/));
  const sharesAfter = toNumber(cellAfterLast(cells, /^보통주식\s*\(주\)$/, 2));
  if (sharesBefore === null && sharesAfter === null) return null;
  return {
    rcept_no,
    sharesBefore,
    sharesAfter,
    faceBefore: toNumber(after(/^1주당\s*가액\s*\(원\)$/)),
    faceAfter: toNumber(cellAfterLast(cells, /^1주당\s*가액\s*\(원\)$/, 2)),
    purpose: meaningful(after(/^\d+\.\s*주식병합목적$/)),
    effectiveDate: meaningful(after(/^신주의\s*효력발생일$/)),
    decisionDate: meaningful(after(/^\d+\.\s*이사회결의일$/)),
    parsedAt: new Date(),
  };
}

export function formatShareConsolidation(d: ShareConsolidationDetail): string[] {
  const lines = header();
  lines.push(
    `      • 주식병합: ${formatShares(d.sharesBefore)} → ${formatShares(d.sharesAfter)} (액면 ${
      d.faceBefore !== null ? d.faceBefore.toLocaleString('ko-KR') : '?'
    }원 → ${d.faceAfter !== null ? d.faceAfter.toLocaleString('ko-KR') : '?'}원)`,
  );
  lines.push('      • ⚠️ 주식병합은 자본금이 줄지 않는 수량 조정입니다. 지분 매도·매수로 해석하지 마세요.');
  if (d.purpose) lines.push(`      • 목적: ${d.purpose}`);
  if (d.effectiveDate) lines.push(`      • 효력발생일: ${d.effectiveDate}`);
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  return lines;
}

// ───────────────────────── 횡령배임 / 회생 / 자기CB 취득 / 잠정실적 ─────────────────────────

export function parseEmbezzlement(xml: string, rcept_no: string): EmbezzlementDetail | null {
  const cells = flatCells(xml);
  const after = afterOf(cells);
  const amount = toNumber(after(/^혐의발생금액\s*\(원\)$/));
  const summary = meaningful(after(/^\d+\.\s*사고발생내용$/));
  if (amount === null && !summary) return null;
  return {
    rcept_no,
    summary,
    amount,
    equity: toNumber(after(/^자기자본\s*\(원\)$/)),
    equityRatio: toNumber(after(/^자기자본대비\s*\(%\)$/)) ?? toNumber(after(/^자기자본\s*대비\s*\(%\)$/)),
    occurDate: meaningful(after(/^\d+\.\s*발생일자$/)),
    confirmDate: meaningful(after(/^\d+\.\s*확인일자$/)),
    measures: meaningful(after(/^\d+\.\s*향후대책$/)),
    parsedAt: new Date(),
  };
}

export function formatEmbezzlement(d: EmbezzlementDetail): string[] {
  const lines = header();
  lines.push(
    moneyLine('혐의 금액', d.amount, d.equityRatio !== null ? `, 자기자본 대비 ${d.equityRatio}%` : ''),
  );
  if (d.summary) lines.push(`      • 내용: ${truncate(d.summary, 180)}`);
  if (d.measures) lines.push(`      • 향후 대책: ${truncate(d.measures, 150)}`);
  if (d.occurDate) lines.push(`      • 발생일: ${d.occurDate}`);
  if (d.confirmDate) lines.push(`      • 확인일: ${d.confirmDate}`);
  return lines;
}

export function parseRehabilitation(xml: string, rcept_no: string): RehabilitationDetail | null {
  const r = acodeReader(xml);
  const applicant = meaningful(r.code('APPL_NM'));
  const court = meaningful(r.code('OSM_214_03'));
  if (!applicant && !court) return null;
  return {
    rcept_no,
    applicant,
    court,
    reason: meaningful(r.code('OSM_214_04')),
    remarks: meaningful(r.code('OSM_214_06')),
    parsedAt: new Date(),
  };
}

export function formatRehabilitation(d: RehabilitationDetail): string[] {
  const lines = header();
  lines.push('      • 구분: 회생절차 개시신청');
  if (d.applicant) lines.push(`      • 신청인: ${d.applicant}`);
  if (d.court) lines.push(`      • 관할법원: ${d.court}`);
  if (d.reason) lines.push(`      • 신청 사유: ${truncate(d.reason, 160)}`);
  if (d.remarks) lines.push(`      • 진행 상황: ${truncate(d.remarks, 200)}`);
  return lines;
}

export function parseOwnCbBuyback(xml: string, rcept_no: string): OwnCbBuybackDetail | null {
  const r = acodeReader(xml);
  const acquireFace = toNumber(r.code('ACQ_CB_PRC'));
  const acquireAmount = toNumber(r.code('ACQ_AMT'));
  if (acquireFace === null && acquireAmount === null) return null;
  return {
    rcept_no,
    kind: meaningful(r.code('PL_KND')),
    issuedAmount: toNumber(r.code('CB_TOT_AMT')),
    acquireFace,
    acquireAmount,
    method: meaningful(r.code('ACQ_MTH')),
    futurePlan: meaningful(r.code('FUTR_PLN')),
    conversionPrice: toNumber(r.code('CV_PRC')),
    conversionShares: toNumber(r.code('CV_STK_CNT')),
    conversionRatio: toNumber(r.code('CV_STK_RT')),
    acquireDate: meaningful(r.unit('ACQ_DT')),
    parsedAt: new Date(),
  };
}

export function formatOwnCbBuyback(d: OwnCbBuybackDetail): string[] {
  const lines = header();
  if (d.kind) lines.push(`      • 사채: ${truncate(d.kind, 80)}`);
  lines.push(
    `      • 만기전 취득: 권면 ${formatWon(d.acquireFace)} / 취득가액 ${formatWon(d.acquireAmount)} (발행총액 ${formatWon(d.issuedAmount)})`,
  );
  if (d.conversionShares !== null || d.conversionRatio !== null) {
    lines.push(
      `      • 해당 전환 주식: ${formatShares(d.conversionShares)}${
        d.conversionRatio !== null ? ` (주식총수 대비 ${d.conversionRatio}%)` : ''
      }`,
    );
  }
  if (d.method) lines.push(`      • 취득 방법: ${d.method}`);
  if (d.futurePlan) lines.push(`      • 향후 계획: ${d.futurePlan}`);
  if (d.acquireDate) lines.push(`      • 취득일: ${d.acquireDate}`);
  return lines;
}

export function parsePreliminaryEarnings(
  xml: string,
  rcept_no: string,
): PreliminaryEarningsDetail | null {
  const cells = flatCells(xml);
  const million = (n: number | null): number | null => (n === null ? null : n * 1_000_000);

  const metric = (label: string): { current: number | null; yoy: number | null } => {
    const i = cells.findIndex((c) => c === label);
    if (i < 0) return { current: null, yoy: null };
    const start = cells[i + 1]?.includes('당해') ? i + 2 : i + 1;
    return {
      current: million(toNumber(cells[start] ?? '')),
      yoy: toNumber(cells[start + 5] ?? '') ?? toNumber(cells[start + 4] ?? ''),
    };
  };

  const revenue = metric('매출액');
  const operating = metric('영업이익');
  const net = metric('당기순이익');
  if (revenue.current === null && operating.current === null && net.current === null) return null;

  const basis = cells.some((c) => c.includes('연결실적')) ? '연결' : '별도';
  return {
    rcept_no,
    basis,
    revenue: revenue.current,
    revenueYoy: revenue.yoy,
    operatingIncome: operating.current,
    operatingYoy: operating.yoy,
    netIncome: net.current,
    netYoy: net.yoy,
    parsedAt: new Date(),
  };
}

export function formatPreliminaryEarnings(d: PreliminaryEarningsDetail): string[] {
  const yoy = (n: number | null): string =>
    n === null ? '' : `, 전년동기 ${n > 0 ? '+' : ''}${n}%`;
  const lines = header();
  lines.push(`      • 기준: ${d.basis} 영업(잠정)실적 (단위 원, 원문 백만원 환산)`);
  if (d.revenue !== null) lines.push(moneyLine('매출액(당기)', d.revenue, yoy(d.revenueYoy)));
  if (d.operatingIncome !== null) {
    lines.push(moneyLine('영업이익(당기)', d.operatingIncome, yoy(d.operatingYoy)));
  }
  if (d.netIncome !== null) lines.push(moneyLine('당기순이익(당기)', d.netIncome, yoy(d.netYoy)));
  return lines;
}

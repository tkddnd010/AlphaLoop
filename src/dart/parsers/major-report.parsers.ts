import type {
  ConvertibleBondDetail,
  FundUse,
  MergerDetail,
  RightsIssueDetail,
  TreasuryAcquisitionDetail,
} from '../interfaces/dart.interface.js';
import {
  acodeReader,
  formatShares,
  formatWon,
  meaningful,
  toNumber,
  truncate,
} from './xml-helpers.js';

/**
 * 주요사항보고서(ACODE/AUNIT 속성 방식) 파서 모음.
 * 모두 XML 문자열만 받는 순수 함수라 샘플 파일로 오프라인 테스트할 수 있다.
 * 값을 못 찾으면 null 을 반환하고, 호출한 쪽은 일반 설명으로 대체한다.
 */

type Reader = ReturnType<typeof acodeReader>;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const signed = (n: number | null, suffix = ''): string =>
  n === null ? '정보 없음' : `${n > 0 ? '+' : ''}${n.toLocaleString('ko-KR')}${suffix}`;

/** 자금 사용 목적 (금액이 있는 항목만). 타법인 증권 취득자금 코드는 문서마다 달라 인자로 받는다. */
function readFundUses(r: Reader, acquisitionCode: string): FundUse[] {
  const defs: [string, string][] = [
    ['시설자금', 'FND_USE1'],
    ['영업양수자금', 'FND_USE_SQ'],
    ['운영자금', 'FND_USE2'],
    ['채무상환자금', 'FND_USE_RD'],
    ['타법인 증권 취득자금', acquisitionCode],
    ['기타자금', 'FND_USE3'],
  ];
  const uses: FundUse[] = [];
  for (const [label, code] of defs) {
    const amount = toNumber(r.code(code));
    if (amount !== null && amount > 0) uses.push({ label, amount });
  }
  return uses;
}

function formatFundUses(uses: FundUse[]): string {
  return uses.map((u) => `${u.label} ${u.amount.toLocaleString('ko-KR')}원`).join(', ');
}

// ───────────────────────── 유상증자 결정 ─────────────────────────

export function parseRightsIssue(xml: string, rcept_no: string): RightsIssueDetail | null {
  const r = acodeReader(xml);

  const newCommon = toNumber(r.code('CST_CNT'));
  const newOther = toNumber(r.code('PST_CNT'));
  if (newCommon === null && newOther === null) return null;
  const newShares = (newCommon ?? 0) + (newOther ?? 0);

  const preCommon = toNumber(r.code('BFR_CST_CNT'));
  const preOther = toNumber(r.code('BFR_PST_CNT'));
  const preShares = preCommon === null && preOther === null ? null : (preCommon ?? 0) + (preOther ?? 0);

  const issuePrice = toNumber(r.code('CST_ISS_VAL'));
  const fundUses = readFundUses(r, 'ANC_ACQ_AMT');
  const fundTotal = fundUses.reduce((sum, u) => sum + u.amount, 0);

  return {
    rcept_no,
    method: r.unit('CI_MTH'),
    newShares,
    preShares,
    dilutionRatio: preShares ? round2((newShares / preShares) * 100) : null,
    issuePrice,
    discountRate: toNumber(r.code('DC_RATE')),
    totalAmount: fundTotal > 0 ? fundTotal : newCommon !== null && issuePrice !== null ? newCommon * issuePrice : null,
    fundUses,
    allocatee: meaningful(r.code('PART')),
    paymentDate: meaningful(r.unit('PYM_DT')),
    listingDate: meaningful(r.unit('LST_PLN_DT')),
    decisionDate: meaningful(r.unit('DRC_DT')),
    exemptionReason: meaningful(r.code('RPT_SBM')),
    parsedAt: new Date(),
  };
}

export function formatRightsIssue(d: RightsIssueDetail): string[] {
  const lines = ['   📊 상세 (원문 파싱):'];
  if (d.method) lines.push(`      • 증자방식: ${d.method}`);
  lines.push(
    `      • 신주: ${formatShares(d.newShares)}${
      d.preShares !== null
        ? ` (증자 전 발행주식 ${formatShares(d.preShares)} 대비 ${d.dilutionRatio}% 증가)`
        : ''
    }`,
  );
  if (d.issuePrice !== null) {
    lines.push(
      `      • 발행가액: ${d.issuePrice.toLocaleString('ko-KR')}원${
        d.discountRate !== null ? ` (기준주가 대비 ${signed(d.discountRate, '%')})` : ''
      }`,
    );
  }
  if (d.totalAmount !== null) {
    lines.push(
      `      • 조달금액: ${formatWon(d.totalAmount)}${
        d.fundUses.length ? ` (용도: ${formatFundUses(d.fundUses)})` : ''
      }`,
    );
  }
  if (d.allocatee) lines.push(`      • 배정대상자: ${d.allocatee}`);
  if (d.paymentDate) lines.push(`      • 납입일: ${d.paymentDate}`);
  if (d.listingDate) lines.push(`      • 신주 상장예정일: ${d.listingDate}`);
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  if (d.exemptionReason) {
    lines.push(`      • 증권신고서 면제사유: ${truncate(d.exemptionReason, 80)}`);
  }
  return lines;
}

// ───────────────────────── 전환사채권 발행결정 ─────────────────────────

export function parseConvertibleBond(xml: string, rcept_no: string): ConvertibleBondDetail | null {
  const r = acodeReader(xml);

  const faceTotal = toNumber(r.code('DNM_SUM'));
  if (faceTotal === null) return null;

  // 발행 대상자는 펀드 수만큼 반복되므로 중복 제거해서 모은다
  const investors = [...new Set(r.all('ISSU_NM').map(meaningful).filter(Boolean))];

  return {
    rcept_no,
    round: meaningful(r.code('SEQ_NO')),
    kind: meaningful(r.code('PL_KND')),
    faceTotal,
    couponRate: toNumber(r.code('PRFT_RATE')),
    maturityRate: toNumber(r.code('LST_RTN_RT')),
    maturityDate: meaningful(r.unit('EXP_DT')),
    conversionPrice: toNumber(r.code('EXE_PRC')),
    conversionShares: toNumber(r.code('STK_CNT')),
    conversionShareRatio: toNumber(r.code('STK_RT')),
    conversionStart: meaningful(r.unit('SB_BGN_DT')),
    conversionEnd: meaningful(r.unit('SB_END_DT')),
    minAdjustPrice: toNumber(r.code('MIN_PRC')),
    hasPutOption: meaningful(r.code('OPT_FCT')) !== '',
    issueMethod: meaningful(r.unit('ISSU_MTH')),
    fundUses: readFundUses(r, 'ANC_ACQ_PRC'),
    investors,
    cumulativeDilution: toNumber(r.code('ISSU_STK_RT')),
    paymentDate: meaningful(r.unit('PYM_DT')),
    decisionDate: meaningful(r.unit('DRC_DT')),
    exemptionReason: meaningful(r.code('RPT_SBM')),
    parsedAt: new Date(),
  };
}

export function formatConvertibleBond(d: ConvertibleBondDetail): string[] {
  const lines = ['   📊 상세 (원문 파싱):'];
  const title = [d.round ? `제${d.round}회` : '', d.kind].filter(Boolean).join(' ');
  lines.push(`      • 사채: ${title || '전환사채'}, 권면총액 ${formatWon(d.faceTotal)}`);
  if (d.couponRate !== null || d.maturityRate !== null) {
    lines.push(
      `      • 이자율: 표면 ${d.couponRate ?? '정보 없음'}% / 만기 ${d.maturityRate ?? '정보 없음'}%`,
    );
  }
  if (d.maturityDate) lines.push(`      • 사채만기일: ${d.maturityDate}`);
  if (d.conversionPrice !== null) {
    lines.push(
      `      • 전환가액: ${d.conversionPrice.toLocaleString('ko-KR')}원${
        d.conversionShares !== null
          ? `, 전부 전환 시 ${formatShares(d.conversionShares)}${
              d.conversionShareRatio !== null ? ` (주식총수 대비 ${d.conversionShareRatio}%)` : ''
            }`
          : ''
      }`,
    );
  }
  if (d.conversionStart || d.conversionEnd) {
    lines.push(`      • 전환청구기간: ${d.conversionStart || '?'} ~ ${d.conversionEnd || '?'}`);
  }
  if (d.minAdjustPrice !== null) {
    lines.push(`      • 최저 조정가액: ${d.minAdjustPrice.toLocaleString('ko-KR')}원`);
  }
  if (d.hasPutOption) lines.push('      • 조기상환청구권(Put Option): 있음');
  if (d.cumulativeDilution !== null) {
    lines.push(
      `      • 누적 희석: 기발행 CB/BW와 이번 사채가 모두 전환되면 기발행주식 대비 ${d.cumulativeDilution}%`,
    );
  }
  if (d.fundUses.length) lines.push(`      • 자금용도: ${formatFundUses(d.fundUses)}`);
  if (d.issueMethod) lines.push(`      • 발행방법: ${d.issueMethod}`);
  if (d.investors.length) {
    const shown = d.investors.slice(0, 3).join(', ');
    const rest = d.investors.length - 3;
    lines.push(`      • 발행대상: ${shown}${rest > 0 ? ` 외 ${rest}곳` : ''}`);
  }
  if (d.paymentDate) lines.push(`      • 납입일: ${d.paymentDate}`);
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  return lines;
}

// ───────────────────────── 자기주식 취득 결정 ─────────────────────────

export function parseTreasuryAcquisition(
  xml: string,
  rcept_no: string,
): TreasuryAcquisitionDetail | null {
  const r = acodeReader(xml);

  const shares = toNumber(r.code('ACQ_OSTK'));
  const amount = toNumber(r.code('ACQ_OSTK_PRC'));
  if (shares === null && amount === null) return null;

  const heldBefore = toNumber(r.code('HLD_OSTK'));
  const heldBeforeRatio = toNumber(r.code('HLD_OSTK_RT'));

  // 발행주식 총수는 공시에 직접 나오지 않아 (보유수 ÷ 보유비율)로 추정한다. 반올림 오차가 있다.
  const ratioOfIssued =
    shares !== null && heldBefore && heldBeforeRatio
      ? round2((shares / (heldBefore / (heldBeforeRatio / 100))) * 100)
      : null;

  return {
    rcept_no,
    shares,
    amount,
    impliedPrice: shares && amount !== null ? Math.round(amount / shares) : null,
    ratioOfIssued,
    periodStart: meaningful(r.unit('ACQ_BGN')),
    periodEnd: meaningful(r.unit('ACQ_END')),
    purpose: meaningful(r.code('ACQ_PPS')),
    method: meaningful(r.code('ACQ_MTH')),
    broker: meaningful(r.code('CI_BRK')),
    heldBefore,
    heldBeforeRatio,
    decisionDate: meaningful(r.unit('ACQ_DATE')),
    parsedAt: new Date(),
  };
}

export function formatTreasuryAcquisition(d: TreasuryAcquisitionDetail): string[] {
  const lines = ['   📊 상세 (원문 파싱):'];
  lines.push(
    `      • 취득 예정: ${formatShares(d.shares)}${
      d.ratioOfIssued !== null ? ` (발행주식 대비 약 ${d.ratioOfIssued}%)` : ''
    }, 예정금액 ${formatWon(d.amount)}${
      d.impliedPrice !== null ? ` (추정 단가 약 ${d.impliedPrice.toLocaleString('ko-KR')}원)` : ''
    }`,
  );
  if (d.periodStart || d.periodEnd) {
    lines.push(`      • 취득 예정기간: ${d.periodStart || '?'} ~ ${d.periodEnd || '?'}`);
  }
  if (d.purpose) lines.push(`      • 취득 목적: ${d.purpose}`);
  if (d.method) lines.push(`      • 취득 방법: ${d.method}`);
  if (d.broker) lines.push(`      • 위탁중개업자: ${d.broker}`);
  if (d.heldBefore !== null) {
    lines.push(
      `      • 취득 전 자기주식: ${formatShares(d.heldBefore)}${
        d.heldBeforeRatio !== null ? ` (${d.heldBeforeRatio}%)` : ''
      }`,
    );
  }
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  return lines;
}

// ───────────────────────── 회사합병 결정 ─────────────────────────

export function parseMerger(xml: string, rcept_no: string): MergerDetail | null {
  const r = acodeReader(xml);

  const method = meaningful(r.code('MGR_MTH'));
  const counterpartyName = meaningful(r.code('OTH_INC'));
  if (!method && !counterpartyName) return null;

  return {
    rcept_no,
    method,
    form: meaningful(r.unit('MGR_FRM')),
    purpose: meaningful(r.code('MGR_RES')),
    ratio: meaningful(r.code('OTH_MGR_RATE')),
    counterpartyName,
    counterpartyBusiness: meaningful(r.code('OTH_PRB')),
    relation: meaningful(r.unit('OTH_RLT')),
    counterpartyAssets: toNumber(r.code('OTH_ASST')),
    counterpartyRevenue: toNumber(r.code('OTH_SALE')),
    counterpartyNetIncome: toNumber(r.code('OTH_NP')),
    externalEvaluation: meaningful(r.unit('EXV_YN')),
    appraisalRight: meaningful(r.code('MGR_STO')),
    mergerDate: meaningful(r.unit('MGR_DT')),
    decisionDate: meaningful(r.unit('DRT_RSLT_DT')),
    parsedAt: new Date(),
  };
}

export function formatMerger(d: MergerDetail): string[] {
  const lines = ['   📊 상세 (원문 파싱):'];
  if (d.method) lines.push(`      • 합병방법: ${d.method}${d.form ? ` (${d.form})` : ''}`);
  if (d.purpose) lines.push(`      • 합병목적: ${d.purpose}`);
  if (d.ratio) lines.push(`      • 합병비율: ${d.ratio}`);
  if (d.counterpartyName) {
    lines.push(
      `      • 합병 상대회사: ${d.counterpartyName}${d.relation ? ` (${d.relation})` : ''}${
        d.counterpartyBusiness ? ` - ${d.counterpartyBusiness}` : ''
      }`,
    );
  }
  if (
    d.counterpartyAssets !== null ||
    d.counterpartyRevenue !== null ||
    d.counterpartyNetIncome !== null
  ) {
    lines.push(
      `      • 상대회사 재무: 자산 ${formatWon(d.counterpartyAssets)}, 매출 ${formatWon(d.counterpartyRevenue)}, 당기순이익 ${formatWon(d.counterpartyNetIncome)}`,
    );
  }
  if (d.externalEvaluation) lines.push(`      • 외부평가: ${d.externalEvaluation}`);
  if (d.appraisalRight) lines.push(`      • 주식매수청구권: ${truncate(d.appraisalRight, 100)}`);
  if (d.mergerDate) lines.push(`      • 합병기일: ${d.mergerDate}`);
  if (d.decisionDate) lines.push(`      • 결정일: ${d.decisionDate}`);
  return lines;
}

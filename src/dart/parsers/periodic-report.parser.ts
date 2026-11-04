import type {
  DartFinancialItem,
  FinancialMetric,
  FinancialSummary,
  ReportPeriod,
} from '../interfaces/dart.interface.js';
import { formatWon, toNumber } from './xml-helpers.js';

/**
 * 정기보고서(사업/반기/분기)는 원문이 수백 쪽이라 원문 파싱 대신
 * DART 단일회사 주요계정 API(fnlttSinglAcnt) 응답을 요약한다.
 * 모두 순수 함수라 API 응답 샘플로 오프라인 테스트할 수 있다.
 */

/**
 * 정기보고서 제목 → 사업연도/보고서 코드.
 * 예) "[기재정정]반기보고서 (2026.06)" → { year: '2026', reprtCode: '11012' }
 * 12월 결산을 가정하므로 분기보고서는 03월=1분기, 09월=3분기만 인식한다 (그 외는 null).
 */
export function parseReportPeriod(reportName: string): ReportPeriod | null {
  const m = reportName.replace(/\s/g, '').match(/(사업|반기|분기)보고서\((\d{4})\.(\d{2})\)/);
  if (!m) return null;
  const [, kind, year, month] = m;

  if (kind === '사업') {
    return { year, reprtCode: '11011', label: `${year}년 사업연도`, isAnnual: true };
  }
  if (kind === '반기') {
    return { year, reprtCode: '11012', label: `${year}년 반기`, isAnnual: false };
  }
  if (month === '03') {
    return { year, reprtCode: '11013', label: `${year}년 1분기`, isAnnual: false };
  }
  if (month === '09') {
    return { year, reprtCode: '11014', label: `${year}년 3분기`, isAnnual: false };
  }
  return null;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** 정기보고서는 대기업 금액이 커서 1조 이상은 조원 단위로 표시 */
function money(n: number | null): string {
  if (n !== null && Math.abs(n) >= 1e12) {
    return `${n.toLocaleString('ko-KR')}원 (약 ${(n / 1e12).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}조원)`;
  }
  return formatWon(n);
}

/** 흑자/적자 상태를 비교 기간과 견줘 표현 */
function profitState(cur: number | null, prev: number | null): string {
  if (cur === null || prev === null) return '';
  if (cur > 0 && prev > 0) return '흑자 지속';
  if (cur > 0 && prev <= 0) return '흑자 전환';
  if (cur <= 0 && prev > 0) return '적자 전환';
  return Math.abs(cur) < Math.abs(prev) ? '적자 축소' : '적자 확대';
}

export function parseFinancialSummary(
  items: DartFinancialItem[],
  period: ReportPeriod,
): FinancialSummary | null {
  // 연결 재무제표가 있으면 연결, 없으면 별도
  const basisCode = items.some((i) => i.fs_div === 'CFS') ? 'CFS' : 'OFS';
  const rows = items.filter((i) => i.fs_div === basisCode);

  const find = (sj: string, name: RegExp): DartFinancialItem | undefined =>
    rows.find((i) => i.sj_div === sj && name.test(i.account_nm.replace(/\s/g, '')));

  // 손익 항목: 누적 금액이 있으면 누적(반기/분기), 없으면 당기 금액 사용
  const metric = (row: DartFinancialItem | undefined, withState: boolean): FinancialMetric => {
    const current = row ? (toNumber(row.thstrm_add_amount ?? '') ?? toNumber(row.thstrm_amount)) : null;
    const previous = row ? (toNumber(row.frmtrm_add_amount ?? '') ?? toNumber(row.frmtrm_amount)) : null;
    return {
      current,
      previous,
      changeRate:
        current !== null && previous !== null && previous !== 0
          ? round1(((current - previous) / Math.abs(previous)) * 100)
          : null,
      state: withState ? profitState(current, previous) : '',
    };
  };

  const revenueRow = find('IS', /^(매출액|수익\(매출액\)|영업수익|매출)$/);
  const operatingRow = find('IS', /^영업이익/);
  const netRow = find('IS', /^당기순/);

  const revenue = metric(revenueRow, false);
  const operatingIncome = metric(operatingRow, true);
  const netIncome = metric(netRow, true);

  const assets = find('BS', /^자산총계$/);
  const liabilities = find('BS', /^부채총계$/);
  const equity = find('BS', /^자본총계$/);
  const capitalRow = find('BS', /^자본금$/);

  const totalAssets = assets ? toNumber(assets.thstrm_amount) : null;
  const totalLiabilities = liabilities ? toNumber(liabilities.thstrm_amount) : null;
  const totalEquity = equity ? toNumber(equity.thstrm_amount) : null;
  const capital = capitalRow ? toNumber(capitalRow.thstrm_amount) : null;
  const prevLiabilities = liabilities ? toNumber(liabilities.frmtrm_amount) : null;
  const prevEquity = equity ? toNumber(equity.frmtrm_amount) : null;

  const ratio = (liab: number | null, eq: number | null): number | null =>
    liab !== null && eq !== null && eq > 0 ? round1((liab / eq) * 100) : null;

  // 손익과 재무상태가 모두 없으면 의미 있는 요약이 아니다
  if (
    revenue.current === null &&
    operatingIncome.current === null &&
    netIncome.current === null &&
    totalAssets === null
  ) {
    return null;
  }

  let capitalStatus: FinancialSummary['capitalStatus'] = '정보 없음';
  if (totalEquity !== null && capital !== null) {
    capitalStatus = totalEquity <= 0 ? '완전잠식' : totalEquity < capital ? '부분잠식' : '정상';
  }

  const hasCumulative = rows.some(
    (i) => i.sj_div === 'IS' && toNumber(i.thstrm_add_amount ?? '') !== null,
  );
  const comparison = period.isAnnual
    ? '당기 vs 전기'
    : hasCumulative
      ? '누적 vs 전년 동기 누적'
      : '당분기 vs 전년 동분기';

  return {
    periodLabel: period.label,
    basis: basisCode === 'CFS' ? '연결' : '별도',
    comparison,
    revenue,
    operatingIncome,
    netIncome,
    totalAssets,
    totalLiabilities,
    totalEquity,
    capital,
    debtRatio: ratio(totalLiabilities, totalEquity),
    prevDebtRatio: ratio(prevLiabilities, prevEquity),
    capitalStatus,
  };
}

export function formatFinancialSummary(s: FinancialSummary): string[] {
  const metricLine = (label: string, m: FinancialMetric): string | null => {
    if (m.current === null) return null;
    const compare =
      m.previous !== null
        ? ` (비교 ${money(m.previous)}${
            m.changeRate !== null ? `, ${m.changeRate > 0 ? '+' : ''}${m.changeRate}%` : ''
          })`
        : '';
    return `      • ${label}: ${money(m.current)}${compare}${m.state ? ` ⇒ ${m.state}` : ''}`;
  };

  const lines = ['   📊 상세 (재무제표 API):'];
  lines.push(`      • 기준: ${s.periodLabel}, ${s.basis}재무제표 (${s.comparison})`);
  for (const line of [
    metricLine('매출액', s.revenue),
    metricLine('영업이익', s.operatingIncome),
    metricLine('당기순이익', s.netIncome),
  ]) {
    if (line) lines.push(line);
  }

  if (s.totalAssets !== null || s.totalLiabilities !== null || s.totalEquity !== null) {
    lines.push(
      `      • 재무상태: 자산총계 ${money(s.totalAssets)}, 부채총계 ${money(s.totalLiabilities)}, 자본총계 ${money(s.totalEquity)}`,
    );
  }
  if (s.debtRatio !== null) {
    lines.push(
      `      • 부채비율: ${s.debtRatio}%${s.prevDebtRatio !== null ? ` (직전 사업연도말 ${s.prevDebtRatio}%)` : ''}`,
    );
  }
  if (s.capitalStatus === '부분잠식') {
    lines.push('      • ⚠️ 자본잠식: 자본총계가 자본금보다 작습니다 (부분잠식)');
  } else if (s.capitalStatus === '완전잠식') {
    lines.push('      • ⚠️ 자본잠식: 자본총계가 0 이하입니다 (완전잠식)');
  }
  return lines;
}

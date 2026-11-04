import type { SupplyContractDetail } from '../interfaces/dart.interface.js';
import {
  cellAfter,
  flatCells,
  formatWon,
  meaningful,
  toNumber,
  truncate,
} from './xml-helpers.js';

/**
 * 거래소 자유서식 공시 파서 모음 (ACODE 없음).
 * 말단 칸을 순서대로 펼친 목록에서 "라벨 칸 바로 다음 칸"을 값으로 읽는다.
 * 회사마다 라벨이 조금씩 달라(예: "확정 계약금액" / "계약금액(원)") 정규식을 느슨하게 쓴다.
 */

// ───────────────────────── 단일판매ㆍ공급계약 체결 ─────────────────────────

export function parseSupplyContract(xml: string, rcept_no: string): SupplyContractDetail | null {
  const cells = flatCells(xml);
  const after = (label: RegExp): string => cellAfter(cells, label);

  // 조건부 계약이 있으면 "계약금액 총액", 없으면 "계약금액(원)" 만 있는 양식도 있다
  const amount =
    toNumber(after(/^계약금액\s*총액\s*\(원\)$/)) ?? toNumber(after(/^계약금액\s*\(원\)$/));
  if (amount === null) return null;

  return {
    rcept_no,
    contractType: meaningful(after(/^\d+\.\s*판매.공급계약\s*구분$/)),
    contractName:
      meaningful(after(/^-?\s*체결계약명$/)) || meaningful(after(/^\d+\.\s*판매.공급계약\s*내용$/)),
    amount,
    recentRevenue: toNumber(after(/^최근\s*매출액\s*\(원\)$/)),
    revenueRatio: toNumber(after(/^매출액\s*대비\s*\(%\)$/)),
    counterparty: meaningful(after(/^\d+\.\s*계약상대방?$/)),
    periodStart: meaningful(after(/^시작일$/)),
    periodEnd: meaningful(after(/^종료일$/)),
    contractDate: meaningful(after(/^\d+\.\s*계약\(수주\)일자$/)),
    withheldReason: meaningful(after(/^유보사유$/)),
    remarks: meaningful(after(/^\d+\.\s*기타\s*투자판단/)),
    parsedAt: new Date(),
  };
}

export function formatSupplyContract(d: SupplyContractDetail): string[] {
  const lines = ['   📊 상세 (원문 파싱):'];
  const what = [d.contractType, d.contractName].filter(Boolean).join(' - ');
  if (what) lines.push(`      • 계약 내용: ${what}`);
  lines.push(
    `      • 계약금액: ${formatWon(d.amount)}${
      d.revenueRatio !== null
        ? ` (회사 최근 매출액${d.recentRevenue !== null ? ` ${formatWon(d.recentRevenue)}` : ''} 대비 ${d.revenueRatio}%)`
        : ''
    }`,
  );
  if (d.counterparty) lines.push(`      • 계약 상대방: ${d.counterparty}`);
  if (d.periodStart || d.periodEnd) {
    lines.push(`      • 계약기간: ${d.periodStart || '?'} ~ ${d.periodEnd || '?'}`);
  }
  if (d.contractDate) lines.push(`      • 계약(수주)일자: ${d.contractDate}`);
  if (d.withheldReason) lines.push(`      • 공시유보 사유: ${d.withheldReason}`);
  if (d.remarks) lines.push(`      • 참고사항: ${truncate(d.remarks, 250)}`);
  return lines;
}

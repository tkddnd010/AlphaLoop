import * as cheerio from 'cheerio';

/**
 * DART 원문 파서들이 공통으로 쓰는 순수 함수 모음 (네트워크/DI 의존 없음).
 * XML 문자열만 받으므로 샘플 파일로 오프라인 테스트할 수 있다.
 */

/** "8,252,643" / "5.02" / "-" 같은 문자열을 숫자로 변환 (값이 없으면 null) */
export function toNumber(text: string): number | null {
  const cleaned = text.replace(/[,\s%]/g, '');
  if (!cleaned || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 원 단위 금액을 억원 단위 문자열로 (소수 첫째 자리, 천 단위 구분) */
export function toEok(won: number): string {
  return (won / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

/** 원 단위 금액 표시: "4,000,000,000원 (약 40억원)" */
export function formatWon(n: number | null): string {
  return n === null ? '정보 없음' : `${n.toLocaleString('ko-KR')}원 (약 ${toEok(n)}억원)`;
}

/** 주식 수 표시: "1,234주" */
export function formatShares(n: number | null): string {
  return n === null ? '정보 없음' : `${n.toLocaleString('ko-KR')}주`;
}

/** "- A (1주)- B (2주)" 처럼 줄바꿈 없이 붙어 있는 대시 목록을 " / " 로 분리 */
export function splitDashList(text: string): string {
  return text
    .split(/(?:^|\s*)-\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' / ');
}

/** 긴 문장 자르기 */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 값이 "-" 한 글자뿐이면 빈 문자열로 */
export function meaningful(text: string): string {
  return text === '-' ? '' : text;
}

const clean = (t: string): string => t.replace(/\s+/g, ' ').trim();

/**
 * ACODE/AUNIT 속성 방식 원문(주요사항보고서 등)용 리더.
 * 같은 코드가 여러 번 나오면 code()는 첫 번째 값, all()은 전부 반환한다.
 */
export function acodeReader(xml: string) {
  const $ = cheerio.load(xml, { xmlMode: true });
  return {
    $,
    code: (c: string): string => clean($(`[ACODE="${c}"]`).first().text()),
    unit: (u: string): string => clean($(`[AUNIT="${u}"]`).first().text()),
    all: (c: string): string[] =>
      $(`[ACODE="${c}"]`)
        .map((_, el) => clean($(el).text()))
        .get(),
  };
}

/**
 * 거래소 자유서식 공시용: 말단 td 의 텍스트를 문서 순서대로 펼친 목록.
 * 빈 칸도 유지해야 값이 비었을 때 다음 라벨이 값으로 잘못 읽히지 않는다.
 */
export function flatCells(xml: string): string[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $('td')
    .filter((_, el) => $(el).find('td').length === 0)
    .map((_, el) => clean($(el).text()))
    .get();
}

/** 펼친 칸 목록에서 라벨 칸을 찾아 그 뒤 offset 번째 칸 텍스트를 반환 (없으면 빈 문자열) */
export function cellAfter(cells: string[], label: RegExp, offset = 1): string {
  const i = cells.findIndex((c) => label.test(c));
  return i >= 0 ? (cells[i + offset] ?? '') : '';
}

/** start 인덱스 이후에서만 라벨을 찾는다 (변경전/변경후처럼 같은 라벨이 두 번 나올 때) */
export function cellAfterFrom(
  cells: string[],
  start: number,
  label: RegExp,
  offset = 1,
): string {
  const i = cells.findIndex((c, idx) => idx >= start && label.test(c));
  return i >= 0 ? (cells[i + offset] ?? '') : '';
}

/** 같은 라벨이 여러 번이면 마지막 것을 쓴다 (기재정정 문서의 정정 후 본문) */
export function cellAfterLast(cells: string[], label: RegExp, offset = 1): string {
  let idx = -1;
  for (let i = 0; i < cells.length; i++) {
    if (label.test(cells[i])) idx = i;
  }
  return idx >= 0 ? (cells[idx + offset] ?? '') : '';
}

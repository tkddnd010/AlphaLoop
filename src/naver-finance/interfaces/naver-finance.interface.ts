/**
 * 네이버 금융 일봉 데이터 (OHLCV)
 */
export interface DailyCandle {
  date: string; // YYYY-MM-DD
  open: number; // 시가
  high: number; // 고가
  low: number; // 저가
  close: number; // 종가
  volume: number; // 거래량
}

/**
 * 기술적 지표 분석 결과
 */
export interface TechnicalIndicators {
  symbol: string;
  
  // 이동평균선
  ma5: number | null; // 5일 이평선
  ma20: number | null; // 20일 이평선
  goldenCross: boolean; // 골든크로스 (5일선 > 20일선)
  
  // 거래량
  avgVolume: number | null; // 평균 거래량 (20일)
  volumeRatio: number | null; // 거래량 비율 (현재/평균)
  volumeSurge: boolean; // 거래량 급증 (200% 이상)
  
  // RSI (Relative Strength Index)
  rsi: number | null; // RSI 값 (0~100)
  rsiOversold: boolean; // 과매도 구간 (RSI < 30)
  
  // 가격 추세
  priceChange5d: number | null; // 5일 전 대비 변화율 (%)
  priceChange20d: number | null; // 20일 전 대비 변화율 (%)
  
  // 원본 데이터
  currentPrice: number;
  candles: DailyCandle[];
}

/**
 * 기술적 점수 계산 결과
 */
export interface TechnicalScore {
  symbol: string;
  score: number; // 0~10점
  signals: string[]; // 매수 신호 목록
  warnings: string[]; // 경고 사항
  indicators: TechnicalIndicators;
}

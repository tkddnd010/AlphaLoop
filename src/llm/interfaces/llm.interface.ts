/**
 * LLM 분석 결과 인터페이스
 */

/** 종목 분석 결과 */
export interface StockAnalysisResult {
  stockCode: string;
  companyName: string;
  currentPrice: number;
  score: number; // 1~10점
  reason: string; // 매수 추천 사유
  recommendation: 'BUY' | 'HOLD' | 'SELL';
  confidence: number; // 신뢰도 0~100%
  disclosureSummary: string; // 공시 요약
  analyzedAt: Date;
}

/** LLM 분석 요청 데이터 */
export interface AnalysisInput {
  stockCode: string;
  companyName: string;
  currentPrice: number;
  disclosures: string; // DART 공시 요약
}

/** OpenAI 응답 파싱 결과 */
export interface ParsedLLMResponse {
  score: number;
  reason: string;
  recommendation: 'BUY' | 'HOLD' | 'SELL';
  confidence: number;
}

/** 배치 분석 결과 */
export interface BatchAnalysisResult {
  totalAnalyzed: number;
  results: StockAnalysisResult[];
  highScoreStocks: StockAnalysisResult[]; // 7점 이상
  recommendations: StockAnalysisResult[]; // BUY 추천
}

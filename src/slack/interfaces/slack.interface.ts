/**
 * Slack 메시지 전송 시 사용하는 매수 추천 정보
 */
export interface BuyRecommendation {
  strategyLogId: number; // StrategyLog의 ID (결재 승인 시 업데이트용)
  symbol: string; // 종목 코드 (예: "005930")
  companyName?: string; // 회사명 (예: "삼성전자")
  currentPrice: number; // 현재가
  reason: string; // LLM 추천 사유
  llmScore: number; // LLM 평가 점수 (1~10)
  dartId?: string; // 분석한 DART 공시 번호
}

/**
 * Slack Interactive Button 액션 페이로드 (승인/거절)
 */
export interface SlackActionPayload {
  type: 'block_actions';
  user: {
    id: string;
    username: string;
    name: string;
  };
  actions: Array<{
    action_id: string; // 'approve_buy' or 'reject_buy'
    value: string; // strategyLogId
    block_id: string;
  }>;
  message: {
    ts: string; // 메시지 타임스탬프 (업데이트 시 필요)
  };
  channel: {
    id: string;
  };
  response_url: string;
}

/**
 * Slack 결재 결과
 */
export interface ApprovalResult {
  success: boolean;
  message: string;
  strategyLogId: number;
  orderResult?: any; // 매수 주문 결과
}

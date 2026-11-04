import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type {
  StockAnalysisResult,
  AnalysisInput,
  ParsedLLMResponse,
  BatchAnalysisResult,
} from './interfaces/llm.interface.js';

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);
  private readonly openai: OpenAI;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.getOrThrow<string>('OPENAI_API_KEY');
    const baseURL = this.configService.get<string>('OPENAI_BASE_URL');
    
    this.openai = new OpenAI({ 
      apiKey,
      baseURL: baseURL || 'https://api.openai.com/v1',
    });
    
    this.logger.log(`✅ LLM Service initialized (${baseURL ? '영남이공대 AI Gateway' : 'OpenAI Direct'})`);
  }

  /**
   * 종목 분석 (공시 데이터 + 현재가)
   * @param input 분석 입력 데이터
   * @returns 분석 결과
   */
  async analyzeStock(input: AnalysisInput): Promise<StockAnalysisResult> {
    try {
      this.logger.log(`🤖 ${input.stockCode} 종목 분석 시작...`);

      const prompt = this.buildAnalysisPrompt(input);

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-6-luna', // 영남이공대 AI Gateway - GPT-6 Luna (최신, 저가형)
        messages: [
          {
            role: 'system',
            content: `당신은 한국 주식 시장 전문 투자 분석가입니다. 
공시 자료와 현재가를 분석하여 객관적이고 신뢰할 수 있는 투자 판단을 제공합니다.
응답은 반드시 JSON 형식으로 제공하세요.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices[0].message.content || '{}';
      const parsed = this.parseLLMResponse(content);

      this.logger.log(
        `✅ ${input.stockCode} 분석 완료: ${parsed.score}점 (${parsed.recommendation})`,
      );

      return {
        stockCode: input.stockCode,
        companyName: input.companyName,
        currentPrice: input.currentPrice,
        score: parsed.score,
        reason: parsed.reason,
        recommendation: parsed.recommendation,
        confidence: parsed.confidence,
        disclosureSummary: input.disclosures,
        analyzedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`❌ ${input.stockCode} 분석 실패: ${error}`);
      throw error;
    }
  }

  /**
   * 여러 종목 일괄 분석
   * @param inputs 분석 입력 데이터 배열
   * @returns 배치 분석 결과
   */
  async analyzeBatch(inputs: AnalysisInput[]): Promise<BatchAnalysisResult> {
    const results: StockAnalysisResult[] = [];

    for (const input of inputs) {
      try {
        const result = await this.analyzeStock(input);
        results.push(result);

        // Rate Limit 방지 (OpenAI API)
        await this.sleep(1000);
      } catch (error) {
        this.logger.warn(`⚠️ ${input.stockCode} 분석 건너뜀: ${error}`);
      }
    }

    const highScoreStocks = results.filter((r) => r.score >= 7);
    const recommendations = results.filter((r) => r.recommendation === 'BUY');

    return {
      totalAnalyzed: results.length,
      results,
      highScoreStocks,
      recommendations,
    };
  }

  /**
   * LLM 프롬프트 생성
   */
  private buildAnalysisPrompt(input: AnalysisInput): string {
    return `
당신은 한국 주식 시장 전문 애널리스트입니다. 다음 종목을 분석하고 명확한 기준에 따라 투자 점수를 매겨주세요.

【종목 정보】
- 종목코드: ${input.stockCode}
- 회사명: ${input.companyName}
- 현재가: ${input.currentPrice > 0 ? input.currentPrice.toLocaleString() + '원' : '정보 없음 (공시만 분석)'}

【최근 공시 (30일)】
${input.disclosures}

【채점 기준 (엄격히 적용)】

※ 아래 기준의 %·%p 는 공시에 '표시된 값'만 사용합니다. 값이 표시되지 않았으면 추정하지 말고 한 단계 낮은 구간을 적용하세요.

⭐ 9-10점 (강력 매수 - STRONG BUY):
- 대량보유 보고서 원문 기준 보유비율 +5%p 이상 증가
- 단일판매·공급계약이 최근 매출액 대비 50% 이상 (계약 상대방·금액이 확인될 때만. 공시유보/상대방 불명이면 8점)
- 자기주식 취득(직접 취득·신탁 체결) 또는 소각이 발행주식 대비 5% 이상

⭐ 7-8점 (매수 - BUY):
- 대량보유 보고서 원문 기준 보유비율 +2%p 이상 증가, 또는 신규로 5% 이상 취득
  (보유목적이 '경영참가'면 8점, '단순투자'면 7점)
- 단일판매·공급계약 (계약 상대방·금액이 확인될 것. 공시유보/상대방 불명이면 한 단계 낮춤):
  · 최근 매출액 대비 30% 이상: 8점
  · 5~30%: 7점
  · 5% 미만이거나 매출액 대비 %가 없으면: 6점
- 자기주식 취득(직접 취득·신탁 체결) 결정: 규모와 관계없이 7점. 발행주식 대비 1% 이상이면 8점
- 자기주식 소각 결정: 규모와 관계없이 7점. 발행주식 대비 1% 이상이면 8점
- 무상증자·주식배당·현금배당 결정: 7점 (시가배당률 1% 미만 현금배당은 6점)
- 자기전환사채 만기전 취득 후 소각 예정: 전환 희석이 줄어드는 신호로 7점
- 임원/주요주주 장내 매수로 보유비율 +1%p 이상 증가: 7점 (그 미만 증가는 6점)
- 정기보고서 또는 영업(잠정)실적: 영업이익 흑자 전환, 또는 매출액과 영업이익이 모두 비교 기간 대비 +20% 이상 증가: 7점
  (이미 알려진 실적이 반영돼 있을 수 있으므로 실적 공시 단독 최고점은 7점)
- 신규시설투자: 자기자본 대비 10% 이상이면서 생산능력·성장 목적이면 7점, 그 미만 6점

⭐ 5-6점 (중립/관망 - HOLD):
- 단순 보유 상황 보고 (보유비율 변동 ±1%p 미만, 또는 변동 내용이 불명확)
- IR/기업설명회 개최 단독: 개최 사실만으로는 호재·악재가 아닙니다. 주요내용에 구체적 실적·계약 수치가 있으면 6점, 없으면 5점
- 자기주식 처분이 임직원 보상(상여·성과급·스톡옵션 등) 목적: 5점
- 정기보고서: 흑자 유지이면서 매출액·영업이익 변동이 ±20% 이내
- 합병·회사분할·주식병합 등 조건이 불명확하거나 지분율이 그대로인 구조 변경: 5점
- 최대주주 변경·양수도 계약: 지배구조 변화이므로 5점 (회생·자본잠식 동반 시 아래 주의 구간)
- 자기주식 신탁계약 해지: 취득 완료에 따른 해지면 5점, 해지 후 처분 계획이 있으면 4점
- 풍문·보도 해명(미확정): 5점. 확정 해명은 내용의 호재/악재에 따름
- 판단하기 어려운 중립적 공시, 공시가 없거나 의미 없는 경우

⭐ 3-4점 (주의 - CAUTION):
- 유상증자 결정 (기존 주주 지분 희석, 호재로 보지 않음):
  · 희석률(증자 전 발행주식 대비 증가율) 10% 미만이면서 자금 용도가 시설·타법인 인수 등 성장 투자: 4점
  · 그 외(운영자금·채무상환 목적이거나 희석률 10% 이상): 3점
  · 기준주가 대비 할인율이 크거나 제3자배정 대상이 불명확하면 더 낮게 보고, 배정 대상이 전략적 투자자이고 성장 투자 목적이면 한 단계 가산 가능
- 전환사채(CB) 발행 결정: 누적 희석률 10% 이상이거나 자금 용도가 운영·채무상환이면 3점, 그 외 4점
- 금전대여·단기차입금 증가·채무보증·담보제공: 자기자본 대비 10% 이상 3점 / 5~10% 4점 / 5% 미만 5점(중립)
- 타법인 주식 취득: 자기자본 대비 20% 이상이거나 대상 회사가 적자·자본잠식이면 4점, 그 외 성장 목적의 소규모 취득은 6점
- 타법인 주식 처분·유형자산 양도: 영업자산 매각·유동성 확보 목적이면 4점, 단순 계열 재편은 5점
- 단일판매·공급계약 해지: 최근 매출액 대비 10% 이상이면 3~4점
- 전환가액 하향 조정: 전환가능 주식수가 늘면 희석이므로 4점
- 감자(무상감자·회생 관련): 3점. 유상감자로 주주가치 환원이 확인되면 6점
- 소송 제기: 3~4점 (경영권 분쟁·대규모 청구는 3점)
- 자기주식 처분이 시장 매각·제3자 대상(보상 목적이 아님): 4점
- 대량보유 보고서 원문 기준 보유비율이 5% 미만으로 하락(대량보유자에서 제외)하거나 -2%p 이상 감소: 3점
- 대량보유 보고서 원문 기준 보유비율 -1%p ~ -2%p 감소: 4점
- 임원/주요주주 장내 매도로 보유비율 -1%p 이상 감소: 3점 (그 미만 감소는 4점)
- 정기보고서: 영업이익 적자 전환·적자 확대, 또는 매출액 -20% 이상 감소: 4점 / 자본 부분잠식: 3점

⭐ 1-2점 (매도 - SELL):
- 임원/주요주주 매도로 보유비율 -5%p 이상 감소 (주식병합·분할 등 수량 조정 제외)
- 영업정지, 상장폐지 위기
- 감사의견 거절, 회계 부정
- 자본 완전잠식 (자본총계 0 이하), 대규모 손실·부채 급증
- 회생절차 개시신청, 파산신청
- 횡령·배임 혐의: 자기자본 대비 5% 이상이거나 경영진 관련이면 2점, 그 외 3점

【점수 → recommendation 변환표 (반드시 준수)】
| score | recommendation |
|-------|----------------|
| 7~10  | BUY            |
| 3~6   | HOLD           |
| 1~2   | SELL           |
- 3~4점(주의)도 recommendation은 HOLD입니다. 대신 reason 첫 문장에 '주의'가 필요한 이유를 명시하세요.
- recommendation은 반드시 위 표에서 score에 해당하는 값이어야 하며, score와 어긋나면 안 됩니다.

【중요 원칙】
1. **정보가 부족하면 5-6점(HOLD)**: 제목만으로 호재/악재 판단 불가 시 중립
2. **보수적 접근**: 불확실하면 낮게 평가
3. **구체적 근거 필수**: reason에 어떤 공시가 왜 호재/악재인지 명확히 서술
4. **confidence는 정보의 명확성**: 상세 내용 없으면 낮게 (20-40%)
5. **원문 수치가 있으면 그 수치로 판단**: '📊 상세 (원문 파싱)' 또는 '📊 상세 (재무제표 API)'에 수치가 있으면(보유비율, 희석률, 자기자본 대비 %, 매출액 대비 %, 영업이익 증감 등)
   '정보 부족'으로 처리하지 말고 표시된 값을 위 기준에 적용하세요. 이 경우 confidence는 50% 이상으로 평가합니다.
   '💡' 줄은 공시 유형에 대한 일반 설명일 뿐 호재/악재 판정이 아닙니다. 수치가 있으면 수치를 우선하세요.
6. **기관 지분 감소만으로는 1-2점(SELL)을 주지 않습니다**: 매도 배경(차익실현/펀드 환매 등)을 알 수 없으므로 최저 3점입니다.
7. **여러 공시가 상충하면** 주가 영향이 가장 큰 공시를 기준으로 점수를 정하고, reason에 나머지 공시의 영향도 함께 서술하세요.
8. **매매가 아닌 수량 조정은 매수/매도 신호가 아닙니다**: 임원·주요주주 보고서의 변동사유가 주식병합·분할·무상증자 등이면 보유주식수가 크게 줄거나 늘어도 지분 변화로 해석하지 말고, 보유비율이 그대로면 중립(5점)으로 보세요. 이런 보고서의 보유주식수 감소를 '임원 매도'로 쓰면 안 됩니다. 다만 주식병합 등 자본 변동 사실 자체는 reason에 언급할 수 있습니다.
9. **같은 건의 원공시와 [기재정정] 공시는 하나로 취급**: 한 번만 반영하고 점수를 이중으로 주지 마세요. 정정된 값이 있으면 정정 후 수치를 기준으로 하되, '📊 기재정정' 줄에서 금액·조건이 바뀌었다면 reason에 언급하세요.
10. **같은 유형 공시가 여러 건이어도 건수가 아니라 내용(수치)으로 판단**: IR 개최가 여러 번이라고 점수를 올리지 않습니다.
11. **표시되지 않은 수치는 만들어내지 마세요**: 주가 영향이 큰 수치(희석률, 자기자본 대비 %, 매출액 대비 % 등)가 없으면 그 사실을 reason에 쓰고, 한 단계 낮은 구간과 낮은 confidence(20-40%)를 적용하세요.

【응답 형식 (JSON)】
{
  "score": 5,
  "reason": "가장 영향이 큰 대량보유상황보고서는 보유비율이 +0.4%p 변동에 그쳐 지분 변화로 보기 어렵습니다. 함께 공시된 IR 개최는 구체적 수치가 없어 중립입니다. 5-6점 구간(변동 ±1%p 미만, 수치 없는 IR)에 해당해 5점으로 평가하며, 나머지 공시도 매수·매도 신호가 되지 않습니다.",
  "recommendation": "HOLD",
  "confidence": 50
}

위 채점 기준을 **엄격히** 적용하여 JSON으로 작성해주세요.
score는 1~10 사이의 정수, recommendation은 위 변환표에 따라 BUY/HOLD/SELL 중 하나, confidence는 0~100 사이의 정수입니다.
reason은 최소 80자 이상, 어떤 공시가 어떻게 영향을 미치는지 구체적으로 서술하세요.
`.trim();
  }

  /**
   * LLM 응답 파싱
   */
  private parseLLMResponse(content: string): ParsedLLMResponse {
    try {
      const json = JSON.parse(content);

      return {
        score: Math.max(1, Math.min(10, parseInt(json.score, 10) || 5)),
        reason: json.reason || '분석 사유를 가져올 수 없습니다.',
        recommendation: this.validateRecommendation(json.recommendation),
        confidence: Math.max(0, Math.min(100, parseInt(json.confidence, 10) || 50)),
      };
    } catch (error) {
      this.logger.error(`❌ LLM 응답 파싱 실패: ${error}`);

      return {
        score: 5,
        reason: '응답 파싱 실패로 기본 점수를 부여했습니다.',
        recommendation: 'HOLD',
        confidence: 0,
      };
    }
  }

  /**
   * 추천 유효성 검증
   */
  private validateRecommendation(
    value: string,
  ): 'BUY' | 'HOLD' | 'SELL' {
    const normalized = value?.toUpperCase();
    if (normalized === 'BUY' || normalized === 'HOLD' || normalized === 'SELL') {
      return normalized;
    }
    return 'HOLD';
  }

  /**
   * 지연 함수
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

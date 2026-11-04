/**
 * DART Open API 인터페이스
 */

/** DART API 공시 검색 응답 */
export interface DartListResponse {
  status: string;
  message: string;
  page_no: number;
  page_count: number;
  total_count: number;
  total_page: number;
  list: DartDisclosure[];
}

/** DART 공시 정보 */
export interface DartDisclosure {
  corp_code: string; // 고유번호
  corp_name: string; // 회사명
  stock_code: string; // 종목코드 (6자리)
  corp_cls: string; // 법인구분 (Y: 유가, K: 코스닥, N: 코넥스, E: 기타)
  report_nm: string; // 보고서명
  rcept_no: string; // 접수번호 (공시 고유 ID)
  flr_nm: string; // 공시 제출인명
  rcept_dt: string; // 접수일자 (YYYYMMDD)
  rm: string; // 비고
}

/** 공시 검색 필터 */
export interface DartSearchFilter {
  corp_code?: string; // 고유번호 (corp_code 또는 stock_code 중 하나 필수)
  stock_code?: string; // 종목코드 (6자리)
  bgn_de: string; // 시작일 (YYYYMMDD)
  end_de?: string; // 종료일 (YYYYMMDD, 기본값: 당일)
  page_no?: number; // 페이지 번호 (기본값: 1)
  page_count?: number; // 페이지당 건수 (기본값: 10, 최대 100)
  pblntf_ty?: string; // 공시유형 (A: 정기공시, B: 주요사항보고, C: 발행공시, D: 지분공시, E: 기타공시, F: 외부감사관련, G: 펀드공시, H: 자산유동화, I: 거래소공시, J: 공정위공시)
}

/** 종목별 최근 공시 요약 */
export interface StockDisclosureSummary {
  stockCode: string;
  companyName: string;
  totalDisclosures: number;
  recentDisclosures: DartDisclosure[];
  hasImportantDisclosure: boolean; // 중요 공시 여부
  latestDisclosureDate?: string; // 가장 최근 공시일
}

/** DART API 에러 응답 */
export interface DartErrorResponse {
  status: string;
  message: string;
}

/** 대량보유 상황 상세 정보 (HTML 파싱 결과) */
export interface MajorStockDetail {
  rcept_no: string; // 접수번호
  reporter: string; // 보고자 (RPT_RSP_NM)
  reportType: string; // 보고구분: 신규/변동/변경 (RPT_DST1)
  holdingPurpose: string; // 보유목적: 단순투자/일반투자/경영참가 (PUR_OWN)
  reportReason: string; // 보고사유 (SUM_CHN_RWN)
  prevShares: number | null; // 직전 보유주식수 (SUM_BMT_CNT)
  prevRatio: number | null; // 직전 보유비율 % (SUM_BMT_RT)
  currShares: number | null; // 이번 보유주식수 (SUM_TMT_CNT)
  currRatio: number | null; // 이번 보유비율 % (SUM_TMT_RT)
  sharesChange: number | null; // 증감 주식수 (curr - prev)
  ratioChange: number | null; // 증감 비율 %p (curr - prev)
  parsedAt: Date;
}

/** 임원·주요주주 소유 상세 정보 */
export interface ExecutiveStockDetail {
  rcept_no: string; // 접수번호
  holderName: string; // 보고자명 (IFR_NM)
  holderType: string; // 보고자 구분: 개인(국내)/국내법인 등 (IFR_TP)
  role: string; // 직위/지위: "등기임원 상무", "사실상지배주주" 등 (STF_RYN + STF_PSM + MAIN_SH)
  reportType: string; // 보고구분: 신규/변동 (RPT_DST)
  prevShares: number | null; // 직전 보고 보유수 (BFR_UN_CNT)
  currShares: number | null; // 이번 보고 보유수 (AFR_UN_CNT)
  sharesChange: number | null; // 증감 수 (MDF_UN_CNT)
  prevRatio: number | null; // 직전 보유비율 % (BFR_UN_RT)
  currRatio: number | null; // 이번 보유비율 % (AFR_UN_RT)
  ratioChange: number | null; // 증감 비율 %p (MDF_UN_RT)
  reasons: string[]; // 변동 사유 목록 (RPT_RSN): 장내매수/장내매도/주식병합 등
  remarks: string; // 비고 (RMK)
  isShareAdjustmentOnly: boolean; // 주식병합·분할 등 매매가 아닌 수량 조정만 있는 경우
  parsedAt: Date;
}

/** 기재정정 공시의 정정사항 한 줄 */
export interface DisclosureCorrection {
  item: string; // 정정 항목 (예: "2. 처분 대상 주식 가격")
  reason: string; // 정정사유 (예: "단순 오기")
  before: string; // 정정 전
  after: string; // 정정 후
}

/** 기업설명회(IR) 개최 상세 정보 (거래소 자유서식이라 ACODE 대신 라벨 기반으로 파싱) */
export interface IrEventDetail {
  rcept_no: string; // 접수번호
  startDate: string; // 행사 시작일 (예: 2026-10-07)
  endDate: string; // 행사 종료일
  startTime: string; // 시작시간 (예: 13:30)
  endTime: string; // 종료시간
  place: string; // 장소
  audience: string; // 대상자
  purpose: string; // 실시목적
  method: string; // 실시방법
  content: string; // 주요내용
  sponsors: string; // 후원기관
  confirmedDate: string; // 개최확정일
  materialPostedAt: string; // IR 자료 게재일시
  parsedAt: Date;
}

/** 정기보고서 제목에서 뽑은 보고 기간 정보 */
export interface ReportPeriod {
  year: string; // 사업연도 (bsns_year)
  reprtCode: '11011' | '11012' | '11013' | '11014'; // 사업/반기/1분기/3분기
  label: string; // 예: "2026년 반기"
  isAnnual: boolean; // 사업보고서 여부
}

/** DART 단일회사 주요계정 API(fnlttSinglAcnt) 응답의 한 줄 */
export interface DartFinancialItem {
  fs_div: string; // CFS(연결) / OFS(개별)
  sj_div: string; // BS(재무상태표) / IS(손익계산서)
  account_nm: string; // 계정명
  thstrm_amount: string; // 당기 금액 (반기/분기 손익은 해당 분기 단독)
  thstrm_add_amount?: string; // 당기 누적 금액 (반기/분기 손익)
  frmtrm_amount: string; // 전기(또는 전년 동기) 금액
  frmtrm_add_amount?: string; // 전년 동기 누적 금액
}

/** 손익 항목 하나의 당기/비교기간 값 */
export interface FinancialMetric {
  current: number | null;
  previous: number | null;
  changeRate: number | null; // 증감률 % (비교 기간 값이 0이거나 없으면 null)
  state: string; // 흑자 전환/적자 확대 등 (매출액은 빈 문자열)
}

/** 정기보고서 재무 요약 */
export interface FinancialSummary {
  periodLabel: string; // 예: "2026년 반기"
  basis: '연결' | '별도';
  comparison: string; // 비교 기준 설명 (예: "누적 vs 전년 동기 누적")
  revenue: FinancialMetric;
  operatingIncome: FinancialMetric;
  netIncome: FinancialMetric;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  capital: number | null; // 자본금
  debtRatio: number | null; // 부채비율 % (부채총계 / 자본총계)
  prevDebtRatio: number | null; // 직전 사업연도말 부채비율 %
  capitalStatus: '정상' | '부분잠식' | '완전잠식' | '정보 없음';
}

/** 자금 사용 목적 한 줄 (시설/운영/채무상환 등) */
export interface FundUse {
  label: string;
  amount: number;
}

/** 유상증자 결정 상세 정보 */
export interface RightsIssueDetail {
  rcept_no: string;
  method: string; // 증자방식: 제3자배정증자/일반공모증자/주주배정증자 등 (CI_MTH)
  newShares: number | null; // 신주 수 (보통주 + 기타주식)
  preShares: number | null; // 증자 전 발행주식 총수 (보통주 + 기타주식)
  dilutionRatio: number | null; // 신주 / 증자 전 발행주식 % (계산값)
  issuePrice: number | null; // 신주 발행가액 원 (CST_ISS_VAL)
  discountRate: number | null; // 기준주가 대비 할인율(-)/할증률(+) % (DC_RATE)
  totalAmount: number | null; // 조달 총액 원 (자금용도 합계, 없으면 신주수 × 발행가액)
  fundUses: FundUse[]; // 자금 사용 목적
  allocatee: string; // 제3자배정 대상자 (PART)
  paymentDate: string; // 납입일
  listingDate: string; // 신주 상장 예정일
  decisionDate: string; // 이사회결의일
  exemptionReason: string; // 증권신고서 면제 사유 (RPT_SBM)
  parsedAt: Date;
}

/** 전환사채권 발행결정 상세 정보 */
export interface ConvertibleBondDetail {
  rcept_no: string;
  round: string; // 회차 (SEQ_NO)
  kind: string; // 사채 종류 (PL_KND)
  faceTotal: number | null; // 권면총액 원 (DNM_SUM)
  couponRate: number | null; // 표면이자율 % (PRFT_RATE)
  maturityRate: number | null; // 만기이자율 % (LST_RTN_RT)
  maturityDate: string; // 사채만기일 (EXP_DT)
  conversionPrice: number | null; // 전환가액 원/주 (EXE_PRC)
  conversionShares: number | null; // 전환 시 발행 주식수 (STK_CNT)
  conversionShareRatio: number | null; // 전환 주식수 / 주식총수 % (STK_RT)
  conversionStart: string; // 전환청구 시작일 (SB_BGN_DT)
  conversionEnd: string; // 전환청구 종료일 (SB_END_DT)
  minAdjustPrice: number | null; // 최저 조정가액 원 (MIN_PRC)
  hasPutOption: boolean; // 조기상환청구권(Put Option) 존재 (OPT_FCT)
  issueMethod: string; // 발행방법: 사모/공모 (ISSU_MTH)
  fundUses: FundUse[]; // 자금 사용 목적
  investors: string[]; // 발행 대상자 (ISSU_NM, 중복 제거)
  cumulativeDilution: number | null; // 기발행 CB/BW 포함 전환 시 기발행주식 대비 % (ISSU_STK_RT)
  paymentDate: string; // 납입일
  decisionDate: string; // 이사회결의일
  exemptionReason: string; // 증권신고서 면제 사유
  parsedAt: Date;
}

/** 자기주식 취득 결정 상세 정보 */
export interface TreasuryAcquisitionDetail {
  rcept_no: string;
  shares: number | null; // 취득 예정 보통주 수 (ACQ_OSTK)
  amount: number | null; // 취득 예정금액 원 (ACQ_OSTK_PRC)
  impliedPrice: number | null; // 추정 단가 원 (예정금액 ÷ 주식수)
  ratioOfIssued: number | null; // 취득 예정 주식이 발행주식에서 차지하는 비율 % (추정치)
  periodStart: string; // 취득 예정기간 시작 (ACQ_BGN)
  periodEnd: string; // 취득 예정기간 종료 (ACQ_END)
  purpose: string; // 취득 목적 (ACQ_PPS)
  method: string; // 취득 방법 (ACQ_MTH)
  broker: string; // 위탁투자중개업자 (CI_BRK)
  heldBefore: number | null; // 취득 전 자기주식 보유수 (HLD_OSTK)
  heldBeforeRatio: number | null; // 취득 전 자기주식 보유비율 % (HLD_OSTK_RT)
  decisionDate: string; // 취득 결정일 (ACQ_DATE)
  parsedAt: Date;
}

/** 회사합병 결정 상세 정보 */
export interface MergerDetail {
  rcept_no: string;
  method: string; // 합병방법 (MGR_MTH)
  form: string; // 합병형태: 소규모합병/간이합병 등 (MGR_FRM)
  purpose: string; // 합병목적 (MGR_RES)
  ratio: string; // 합병비율 (OTH_MGR_RATE)
  counterpartyName: string; // 합병 상대 회사 (OTH_INC)
  counterpartyBusiness: string; // 상대 회사 주요사업 (OTH_PRB)
  relation: string; // 회사와의 관계 (OTH_RLT)
  counterpartyAssets: number | null; // 상대 회사 자산총계 원 (OTH_ASST)
  counterpartyRevenue: number | null; // 상대 회사 매출액 원 (OTH_SALE)
  counterpartyNetIncome: number | null; // 상대 회사 당기순이익 원 (OTH_NP)
  externalEvaluation: string; // 외부평가 여부 (EXV_YN)
  appraisalRight: string; // 주식매수청구권 관련 (MGR_STO)
  mergerDate: string; // 합병기일 (MGR_DT)
  decisionDate: string; // 이사회결의일 (DRT_RSLT_DT)
  parsedAt: Date;
}

/** 단일판매ㆍ공급계약 체결 상세 정보 (거래소 자유서식) */
export interface SupplyContractDetail {
  rcept_no: string;
  contractType: string; // 계약 구분 (예: 공사수주)
  contractName: string; // 계약 내용 / 체결계약명
  amount: number | null; // 계약금액 원 (조건부 포함 총액)
  recentRevenue: number | null; // 회사 최근 매출액 원
  revenueRatio: number | null; // 매출액 대비 %
  counterparty: string; // 계약 상대방
  periodStart: string; // 계약기간 시작일
  periodEnd: string; // 계약기간 종료일
  contractDate: string; // 계약(수주)일자
  withheldReason: string; // 공시유보 사유 (있으면)
  remarks: string; // 기타 투자판단 참고사항
  parsedAt: Date;
}

/** 금전대여 결정 상세 정보 (거래소 자유서식) */
export interface MoneyLendingDetail {
  rcept_no: string; // 접수번호
  counterparty: string; // 대여 상대방 (성명/법인명)
  relation: string; // 회사와의 관계 (예: 관계회사)
  amount: number | null; // 대여금액 원
  equity: number | null; // 자기자본 원
  equityRatio: number | null; // 자기자본 대비 %
  interestRate: number | null; // 이율 %
  periodStart: string; // 대여기간 시작일
  periodEnd: string; // 대여기간 종료일
  purpose: string; // 대여 목적
  totalBalance: number | null; // 금전대여 총잔액 원 (본 건 포함)
  decisionDate: string; // 이사회결의일
  counterpartyFiscalYear: string; // 상대방 재무 기준 사업연도
  counterpartyRevenue: number | null; // 상대방 매출액 (백만원)
  counterpartyNetIncome: number | null; // 상대방 당기순손익 (백만원)
  remarks: string; // 기타 투자판단에 참고할 사항
  parsedAt: Date;
}

/** 단기차입금 증가 결정 상세 정보 (거래소 자유서식) */
export interface ShortTermBorrowingDetail {
  rcept_no: string; // 접수번호
  amount: number | null; // 차입금액 원
  equity: number | null; // 자기자본 원
  equityRatio: number | null; // 자기자본 대비 %
  totalBefore: number | null; // 단기차입금 합계 (차입 전) 원
  totalAfter: number | null; // 단기차입금 합계 (차입 후) 원
  purpose: string; // 차입 목적
  form: string; // 차입 형태
  decisionDate: string; // 이사회결의일
  remarks: string; // 기타 투자판단에 참고할 사항
  parsedAt: Date;
}

/** 자기주식 처분 결정 상세 정보 */
export interface TreasuryDisposalDetail {
  rcept_no: string; // 접수번호
  decisionDate: string; // 이사회 결의일 (SEL_DATE)
  shares: number | null; // 처분 보통주 수 (SEL_OSTK)
  otherShares: number | null; // 처분 기타주식 수 (SEL_ESTK)
  pricePerShare: number | null; // 처분 단가 원 (SEL_OSTK_SPRC)
  amount: number | null; // 처분 예정금액 원 (SEL_OSTK_PRC)
  periodStart: string; // 처분 예정기간 시작 (SEL_BGN)
  periodEnd: string; // 처분 예정기간 종료 (SEL_END)
  purpose: string; // 처분 목적 (SEL_PPS)
  methods: { label: string; shares: number }[]; // 처분 방법별 수량 (SEL_MTH_*)
  counterparty: string; // 처분 상대방 (DSPS_PARN)
  heldBefore: number | null; // 처분 전 자기주식 보유수 (HLD_OSTK)
  heldBeforeRatio: number | null; // 처분 전 자기주식 보유비율 % (HLD_OSTK_RT)
  ratioOfIssued: number | null; // 처분 주식이 발행주식에서 차지하는 비율 % (추정치)
  corrections: DisclosureCorrection[]; // 기재정정인 경우 정정사항
  parsedAt: Date;
}

/** 감자 결정 */
export interface CapitalReductionDetail {
  rcept_no: string;
  sharesBefore: number | null;
  sharesAfter: number | null;
  reducedShares: number | null;
  reductionRatio: number | null; // 감자비율 %
  capitalBefore: number | null;
  capitalAfter: number | null;
  faceValue: number | null;
  method: string;
  reason: string;
  reductionDate: string;
  decisionDate: string;
  parsedAt: Date;
}

/** 타법인 주식 취득/처분 (거래소 HTML) 또는 양수/양도 (주요사항보고 ACODE) */
export interface OtherCorpStockDetail {
  rcept_no: string;
  kind: '취득' | '처분' | '양수' | '양도';
  company: string;
  relation: string;
  shares: number | null;
  amount: number | null;
  equity: number | null;
  equityRatio: number | null;
  assetTotal: number | null;
  assetRatio: number | null;
  afterShares: number | null;
  afterRatio: number | null;
  purpose: string;
  method: string;
  counterparty: string;
  scheduledDate: string;
  decisionDate: string;
  parsedAt: Date;
}

/** 타인에 대한 채무보증 / 담보제공 */
export interface GuaranteeDetail {
  rcept_no: string;
  kind: '채무보증' | '담보제공';
  debtor: string;
  relation: string;
  creditor: string;
  debtAmount: number | null;
  guaranteeAmount: number | null;
  equity: number | null;
  equityRatio: number | null;
  totalBalance: number | null;
  periodStart: string;
  periodEnd: string;
  collateral: string;
  decisionDate: string;
  remarks: string;
  parsedAt: Date;
}

/** 주식소각 결정 */
export interface ShareCancelDetail {
  rcept_no: string;
  shares: number | null;
  issuedShares: number | null;
  ratioOfIssued: number | null;
  amount: number | null;
  method: string;
  cancelDate: string;
  decisionDate: string;
  remarks: string;
  parsedAt: Date;
}

/** 최대주주 변경 / 양수도 계약 / 담보제공 계약 */
export interface LargestShareholderDetail {
  rcept_no: string;
  kind: '변경' | '양수도계약' | '담보제공계약';
  prevHolder: string;
  prevShares: number | null;
  prevRatio: number | null;
  nextHolder: string;
  nextShares: number | null;
  nextRatio: number | null;
  reason: string;
  purpose: string;
  dealShares: number | null;
  dealAmount: number | null;
  changeDate: string;
  remarks: string;
  parsedAt: Date;
}

/** 소송 제기/판결 */
export interface LawsuitDetail {
  rcept_no: string;
  kind: '제기' | '판결';
  caseName: string;
  party: string;
  court: string;
  content: string;
  date: string;
  remarks: string;
  parsedAt: Date;
}

/** 현금·현물 배당 */
export interface DividendDetail {
  rcept_no: string;
  category: string; // 결산배당/중간배당/분기배당
  type: string; // 현금배당/현물배당
  perShare: number | null;
  yieldRate: number | null;
  totalAmount: number | null;
  recordDate: string;
  payDate: string;
  decisionDate: string;
  parsedAt: Date;
}

/** 증권발행결과 */
export interface SecuritiesIssueResultDetail {
  rcept_no: string;
  securityType: string;
  method: string;
  plannedShares: number | null;
  plannedAmount: number | null;
  actualShares: number | null;
  actualAmount: number | null;
  paymentDate: string;
  remarks: string;
  parsedAt: Date;
}

/** 풍문·보도 해명 */
export interface RumorClarificationDetail {
  rcept_no: string;
  rumor: string;
  media: string;
  rumorDate: string;
  clarification: string;
  reDisclosureDate: string;
  parsedAt: Date;
}

/** 투자판단 관련 주요경영사항 */
export interface ManagementMatterDetail {
  rcept_no: string;
  title: string;
  content: string;
  confirmedDate: string;
  parsedAt: Date;
}

/** 신규시설투자 */
export interface FacilityInvestmentDetail {
  rcept_no: string;
  category: string;
  amount: number | null;
  equity: number | null;
  equityRatio: number | null;
  purpose: string;
  periodStart: string;
  periodEnd: string;
  decisionDate: string;
  parsedAt: Date;
}

/** 자기주식 취득 신탁계약 체결/해지 */
export interface TreasuryTrustDetail {
  rcept_no: string;
  kind: '체결' | '해지';
  amount: number | null;
  purpose: string;
  trustee: string;
  periodStart: string;
  periodEnd: string;
  heldBefore: number | null;
  heldBeforeRatio: number | null;
  acquiredShares: number | null;
  decisionDate: string;
  parsedAt: Date;
}

/** 무상증자 결정 */
export interface BonusIssueDetail {
  rcept_no: string;
  newShares: number | null;
  preShares: number | null;
  ratio: number | null; // 신주 배정 비율 (1이면 1:1)
  recordDate: string;
  listingDate: string;
  decisionDate: string;
  parsedAt: Date;
}

/** 회사분할 결정 */
export interface SplitDetail {
  rcept_no: string;
  method: string;
  purpose: string;
  survivingName: string;
  newName: string;
  survivingAssets: number | null;
  newAssets: number | null;
  remarks: string;
  parsedAt: Date;
}

/** 유형자산 양수/양도/취득 */
export interface TangibleAssetDetail {
  rcept_no: string;
  kind: '양수' | '양도' | '취득';
  assetName: string;
  amount: number | null;
  assetTotal: number | null;
  assetRatio: number | null;
  purpose: string;
  counterparty: string;
  scheduledDate: string;
  decisionDate: string;
  parsedAt: Date;
}

/** 단일판매·공급계약 해지 */
export interface SupplyContractCancelDetail {
  rcept_no: string;
  contractName: string;
  amount: number | null;
  recentRevenue: number | null;
  revenueRatio: number | null;
  counterparty: string;
  reason: string;
  cancelDate: string;
  parsedAt: Date;
}

/** 전환가액 조정 */
export interface ConversionPriceAdjustDetail {
  rcept_no: string;
  round: string;
  priceBefore: number | null;
  priceAfter: number | null;
  sharesBefore: number | null;
  sharesAfter: number | null;
  reason: string;
  applyDate: string;
  parsedAt: Date;
}

/** 주식병합 결정 */
export interface ShareConsolidationDetail {
  rcept_no: string;
  sharesBefore: number | null;
  sharesAfter: number | null;
  faceBefore: number | null;
  faceAfter: number | null;
  purpose: string;
  effectiveDate: string;
  decisionDate: string;
  parsedAt: Date;
}

/** 횡령·배임 혐의 */
export interface EmbezzlementDetail {
  rcept_no: string;
  summary: string;
  amount: number | null;
  equity: number | null;
  equityRatio: number | null;
  occurDate: string;
  confirmDate: string;
  measures: string;
  parsedAt: Date;
}

/** 회생절차 개시신청 */
export interface RehabilitationDetail {
  rcept_no: string;
  applicant: string;
  court: string;
  reason: string;
  remarks: string;
  parsedAt: Date;
}

/** 자기전환사채 만기전 취득 */
export interface OwnCbBuybackDetail {
  rcept_no: string;
  kind: string;
  issuedAmount: number | null;
  acquireFace: number | null;
  acquireAmount: number | null;
  method: string;
  futurePlan: string;
  conversionPrice: number | null;
  conversionShares: number | null;
  conversionRatio: number | null;
  acquireDate: string;
  parsedAt: Date;
}

/** 영업(잠정)실적 공정공시. 금액 단위는 원(원문 백만원을 환산) */
export interface PreliminaryEarningsDetail {
  rcept_no: string;
  basis: string;
  revenue: number | null;
  revenueYoy: number | null;
  operatingIncome: number | null;
  operatingYoy: number | null;
  netIncome: number | null;
  netYoy: number | null;
  parsedAt: Date;
}

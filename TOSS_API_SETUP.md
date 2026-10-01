# 토스증권 API 모듈 (TossModule) 구현 완료

## 📋 개요

Nest.js 기반의 **토스증권 공식 Open API** 완전 통합 모듈입니다.  
토스증권 공식 문서([https://developers.tossinvest.com](https://developers.tossinvest.com))를 100% 준수하여 구현되었습니다.

---

## ✅ 구현 완료 기능

### 1. **Rate Limit 관리 (bottleneck 패키지)**

토스증권 공식 Rate Limits Group에 따라 API 호출 제한을 강제합니다:

| Group | TPS (초당 호출 횟수) | minTime | maxConcurrent |
|-------|---------------------|---------|---------------|
| ACCOUNT | 1 TPS | 1000ms | 1 |
| STOCK | 5 TPS | 200ms | 1 |
| ORDER | 10 TPS | 100ms | 1 |

```typescript
// Rate Limiter 초기화
this.accountLimiter = new Bottleneck({ minTime: 1000, maxConcurrent: 1 });
this.stockLimiter = new Bottleneck({ minTime: 200, maxConcurrent: 1 });
this.orderLimiter = new Bottleneck({ minTime: 100, maxConcurrent: 1 });
```

### 2. **계좌 및 보유 주식 조회**

- `getAccounts()`: 계좌 목록 조회 (`GET /api/v1/accounts`)
- `getMyAccountBalance()`: 보유 종목 조회 (`GET /api/v1/holdings`)
- `getBuyingPower()`: 매수 가능 금액 조회 (`GET /api/v1/buying-power`)

### 3. **현재가 조회 및 가격 필터링**

- `checkPriceUnder30000(symbol: string)`: 
  - 토스 API `GET /api/v1/prices` 호출
  - 현재가가 **30,000원 이하**인지 자동 판별 (KRW 전용)
  - 반환: `{ symbol, currentPrice, currency, isUnder30000, timestamp }`

```typescript
const result = await tossApiService.checkPriceUnder30000('005930');
// { symbol: '005930', currentPrice: 72000, currency: 'KRW', isUnder30000: false, ... }
```

### 4. **1주 주문 집행 (지정가/시장가)**

- `buyMarket1Share(symbol)`: 1주 시장가 매수
- `sellMarket1Share(symbol)`: 1주 시장가 매도
- `buyLimit1Share(symbol, price)`: 1주 지정가 매수
- `sellLimit1Share(symbol, price)`: 1주 지정가 매도
- `createOrder(request)`: 커스텀 주문 생성

### 5. **HTTP 429 재시도 로직 (지수 백오프)**

- 최대 3회 재시도
- 지수 백오프: `1초 → 2초 → 4초` (+ 랜덤 jitter)
- `Retry-After` 헤더 우선 반영
- 타임아웃 발생 시에도 자동 재시도

```typescript
private async executeWithRetry<T>(
  fn: () => Promise<T>,
  errorMessage: string,
  maxRetries = 3,
): Promise<T>
```

### 6. **테스트용 컨트롤러 엔드포인트**

Postman으로 바로 테스트 가능한 RESTful API 제공:

| Method | Endpoint | 설명 | Request Body |
|--------|----------|------|--------------|
| GET | `/toss/balance` | 계좌 잔고 + 보유 종목 + 매수 가능 금액 | - |
| GET | `/toss/price/:symbol` | 현재가 및 30,000원 필터링 | - |
| POST | `/toss/order/buy` | 1주 매수 (시장가/지정가) | `{ symbol, orderType?, price? }` |
| POST | `/toss/order/sell` | 1주 매도 (시장가/지정가) | `{ symbol, orderType?, price? }` |

---

## 📦 설치된 패키지

```bash
npm install bottleneck
```

---

## 🛠️ 사용 예시

### 1. 계좌 잔고 확인

```http
GET http://localhost:3000/toss/balance
```

**응답:**
```json
{
  "accounts": [{ "accountSeq": 123, "accountNo": "1234567890", "accountType": "BROKERAGE" }],
  "holdings": { "deposit": 1000000, "holdings": [...] },
  "buyingPower": { "currency": "KRW", "cashBuyingPower": "950000" }
}
```

### 2. 현재가 확인 (30,000원 이하 여부)

```http
GET http://localhost:3000/toss/price/005930
```

**응답:**
```json
{
  "symbol": "005930",
  "currentPrice": 72000,
  "currency": "KRW",
  "isUnder30000": false,
  "timestamp": "2026-09-23T16:30:00+09:00"
}
```

### 3. 시장가 매수

```http
POST http://localhost:3000/toss/order/buy
Content-Type: application/json

{
  "symbol": "005930"
}
```

### 4. 지정가 매도

```http
POST http://localhost:3000/toss/order/sell
Content-Type: application/json

{
  "symbol": "005930",
  "orderType": "LIMIT",
  "price": "73000"
}
```

---

## ⚙️ 환경 변수 설정 (.env)

```env
# Toss Securities API
CLIENT_ID=tsck_live_xxxxx
CLIENT_SECRET=tssk_live_xxxxx
TOSS_API_BASE_URL=https://openapi.tossinvest.com

# 선택: 특정 계좌 지정 (미지정 시 첫 번째 계좌 사용)
ACCOUNT_NUMBER=1234567890
ACCOUNT_PRODUCT_CODE=01
```

---

## 🔑 토스증권 API 인증 설정

1. **클라이언트 등록**  
   토스증권 WTS > 설정 > Open API에서 `CLIENT_ID`와 `CLIENT_SECRET` 발급

2. **허용 IP 등록**  
   WTS > Open API > 허용 IP 관리에서 서버 IP 등록 (필수)

3. **OAuth2 토큰 발급**  
   서비스 내부에서 자동으로 `POST /oauth2/token` 호출 및 캐싱

---

## 📁 프로젝트 구조

```
src/toss-api/
├── toss-api.module.ts          # 모듈 정의
├── toss-api.service.ts         # 비즈니스 로직 (Rate Limiter, 재시도 로직 포함)
├── toss-api.controller.ts      # 테스트용 REST API
└── interfaces/
    └── toss-api.interface.ts   # TypeScript 타입 정의
```

---

## 🚀 실행 방법

### 1. 개발 모드

```bash
npm run start:dev
```

### 2. 빌드 및 프로덕션 실행

```bash
npm run build
npm run start:prod
```

### 3. 테스트

```bash
npm run test
```

---

## 📊 Rate Limit 동작 확인

```typescript
// 동시에 10개 요청을 보내도, ORDER 그룹은 초당 10회 제한
for (let i = 0; i < 10; i++) {
  await tossApiService.buyMarket1Share('005930');
}
// ✅ bottleneck이 자동으로 100ms 간격으로 순차 실행
```

---

## 🛡️ 에러 처리

### 1. HTTP 401 (토큰 만료)
- 자동으로 `cachedToken` 초기화 후 재발급

### 2. HTTP 403 (허용 IP 미등록)
- WTS에서 IP 등록 필요 (재시도 불가)

### 3. HTTP 429 (Rate Limit 초과)
- 지수 백오프로 최대 3회 재시도
- `Retry-After` 헤더 우선 반영

### 4. 타임아웃 (ECONNABORTED)
- 최대 3회 재시도 (1초 → 2초 → 4초)

---

## 📖 토스증권 공식 문서 참고

- **LLM 가이드**: https://developers.tossinvest.com/llms.txt
- **공식 문서**: https://developers.tossinvest.com/docs
- **OpenAPI 스펙**: https://openapi.tossinvest.com/openapi-docs/latest/openapi.json
- **Rate Limits**: https://openapi.tossinvest.com/openapi-docs/overview.md

---

## ✅ 체크리스트

- [x] bottleneck 패키지를 사용한 TPS 제한 (ACCOUNT: 1, STOCK: 5, ORDER: 10)
- [x] 토스 공식 API 엔드포인트 준수 (`GET /api/v1/prices`, `POST /api/v1/orders` 등)
- [x] OAuth2 Client Credentials Grant 인증
- [x] `X-Tossinvest-Account` 헤더 자동 설정
- [x] 현재가 조회 및 30,000원 이하 필터링
- [x] 1주 주문 집행 (시장가/지정가, 매수/매도)
- [x] HTTP 429 지수 백오프 재시도 (최대 3회)
- [x] Postman 테스트용 RESTful API (`/toss/*`)
- [x] TypeScript 타입 안전성
- [x] Logger를 통한 디버깅 로그

---

## 🎉 완료!

이제 Postman에서 `http://localhost:3000/toss/balance`를 호출하여 테스트할 수 있습니다.

**주의:** 실제 주문은 실제 계좌에 영향을 미치므로, 테스트 계좌를 사용하거나 소액으로 테스트하세요!

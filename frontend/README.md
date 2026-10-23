# Yogimangchi Frontend

Yogimangchi V2의 웹 프론트엔드 프로젝트입니다.

모바일 환경을 기준으로 화면을 설계하고, Tablet과 Desktop으로 확장하는 Mobile First 방식을 사용합니다.

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- TradingView Lightweight Charts
- Native Fetch
- TanStack Query

Redux는 복잡한 전역 Client State 관리가 실제로 필요한 경우에만 도입합니다.

## Development

의존성 설치:

```bash
npm install
```

개발 서버 실행:

```bash
npm run dev
```

기본 개발 주소:

```text
http://localhost:3000
```

## Backend

Trading Server:

```text
http://localhost:8081
```

Swagger UI:

```text
http://localhost:8081/swagger-ui/index.html
```

Runtime OpenAPI:

```text
http://localhost:8081/v3/api-docs
```

API 연동 시 실행 중인 Trading Server의 Runtime OpenAPI를 기준으로 현재 API 계약을 확인합니다.

## Development Flow

페이지와 기능은 다음 순서로 개발합니다.

```text
Markup
  ↓
Design
  ↓
Function
```

마크업, 디자인, 기능 구현은 한 번에 진행하지 않습니다.

세부 개발 규칙은 `AGENTS.md`를 따릅니다.

## Frontend Responsibility

Frontend는 사용자에게 Trading 정보를 표현하고 사용자 입력을 Backend에 전달합니다.

체결 가격, PnL, Margin, Liquidation 등 Trading의 최종 판단은 Trading Server가 담당합니다.

실시간 Trading 데이터 역시 Browser에서 Binance에 직접 연결하지 않고 Trading Server를 통해 사용합니다.

## Guest 조회 세션

`TradingDataProvider`는 Trading workspace만 감싼다. Root Layout은 Server Component를 유지한다.
`@tanstack/react-query` 5.104.2는 조회 캐시, 요청 중복 제거, 취소 및 제한된 재시도를 담당한다.
기존 native fetch는 HTTP 전송에 사용한다. React 18/19를 지원하며 Redux/BFF는 추가하지 않는다.

Guest는 서버에서 발급하는 7일 만료 opaque Bearer credential이다. JWT가 아니다.
토큰은 API 모듈 내부와 `localStorage`의 `yogimangchi.guest.v1:{origin}`에 보관한다.
같은 브라우저 프로필에서는 탭·브라우저를 닫아도 서버의 `expiresAt`까지 복구하며 기간을 연장하지 않는다.
localStorage가 없을 때만 유효한 기존 sessionStorage credential을 옮기고, 저장 성공 후 이전 키를 제거한다.
localStorage가 있으면 우선하며 잘못되거나 만료된 credential을 이전 세션으로 대체하지 않는다.
localStorage도 XSS에는 노출될 수 있으므로 로그·URL·오류·React 화면·Query 캐시에 토큰을 넣지 않는다.
저장소가 차단되면 계정을 생성하기 전에 오류를 표시한다.

mount의 `restore()`는 저장된 Guest만 복구하며 없으면 정상 anonymous 상태로 시세·차트·호가를 제공한다.
Header/주문 영역의 공통 안내 모달에서 시작을 선택해야 `createGuest()`가 POST를 한 번 실행한다.
조회·mutation의 401 또는 로컬 만료는 credential을 제거하고 anonymous로 전환한다. 자동 재생성은 없다.
Guest POST는 자동 재시도하지 않으며 실패 후에도 anonymous를 유지하고 사용자가 다시 선택한다.
계정 ID와 세대 번호로 조회 키를 분리하고 계정 변경 시 이전 조회를 취소하고 조회·mutation 캐시를 제거한다.
REST 읽기는 네트워크 오류, 500/502/503/504, `409 + code=TRADING_BUSY`만 최대 두 번 재시도한다.
다른 409, 인증/입력 오류, 파싱 오류, 취소는 자동 재시도하지 않는다.

도입 시 npm audit: 새 TanStack 패키지 경고 없음. 기존 ESLint 개발 도구 체인의
braces → micromatch → fast-glob 경로에 high 5건이 보고되었다. 제안된 해결은 Next ESLint의
major downgrade이므로 이 작업에서 강제 변경하지 않는다.

Account/Wallet/Positions는 `GET /api/v1/trading/account/summary`의 동일 시점 스냅샷을 공유한다.
별도 `/wallet`, `/positions`도 있지만 같은 Summary를 내부에서 계산하므로 중복 호출하지 않는다.
화면과 Doughnut은 같은 positions를 사용하고 기존 BigInt 증거금 배분 계산을 유지한다.
활성 종목 목록에 없는 과거 종목은 이름을 추측하지 않고 `종목 #ID`로 표시한다.
금융 값은 문자열로 보관하고 null 평가 값은 `—`로 표시한다. Preview 계정/포지션은 제거했다.
조회 시각을 표시하며 Summary/미체결은 5초, 이력은 10초마다 갱신한다.
오류가 나면 주기 조회도 멈추고 제한된 재시도 또는 수동 새로고침으로 복구한다.
Account REST는 실시간 WebSocket이 아니며 Market Chart 오류 상태와 분리된다.

주문 조회는 `/api/v1/trading/account/orders/pending`와 `/api/v1/trading/account/orders?limit=50`을 사용한다.
후자가 주문/체결 이력 API이며 별도의 `/history` 경로는 없다. 서버는 `beforeId` 커서를 지원하지만
현재 화면은 최신 첫 페이지 최대 50건으로 명시한다. 체결 가격은 `fill.price`만 표시한다.
미체결/이력은 독립 Query와 오류·재시도 UI를 가진다. 가짜 계정/포지션/주문 데이터는 유지하지 않는다.
`/api/v1/symbols`의 ACTIVE USDT 종목 전체를 선택할 수 있다. 선택 종목 WS 한 개를
Chart/Header/주문 입력에서 공유하며 최신 Mark Price가 없으면 신규 주문을 막는다.
`GET /api/v1/market/tickers`를 2초마다 조회하여 목록 가격과 24h 통계를 표시한다.
오류 또는 오래된 캐시에는 예시 가격을 대신 표시하지 않는다.

MARKET/LIMIT, LONG/SHORT 주문과 시장가·지정가 부분/전체 청산, 개별 미체결 취소를 지원한다.
주문·청산은 Idempotency-Key를 사용하고 Mutation은 자동 재시도하지 않는다.
결과가 불확실하면 입력을 잠그고 사용자의 재확인에 같은 요청·키를 재사용한다.
Mutation의 401은 새 Guest로 재전송하지 않는다. 완료 후 Summary/미체결/이력을 갱신한다.
금융 값은 Decimal 문자열로 유지하고 참고 금액/비율 입력만 BigInt로 계산한다.
주문 영역의 Open/Close 탭에서 진입 또는 보유 포지션별 시장가·지정가 청산을 선택한다.
Close 탭의 비율은 Wallet이 아닌 서버 `freeCloseQuantity` 기준이며 예약 수량을 초과할 수 없다.
포지션 행의 부분 청산은 행 안에서 수량·가격·1% 단위 비율을 입력하며 전체 보유 수량 미만만 허용한다.
별도 전체 청산 버튼은 확인 후 보유 수량 전부를 시장가 청산하며, 예약된 청산 수량이 있으면 먼저 취소해야 한다.
탭·포지션 전환에도 진행 중/미확정 요청 상태를 유지하며 같은 요청·키로만 재확인한다.
PC는 상단 종목 검색·시세, 중앙 차트·호가, 우측 주문, 하단 포지션 구조다. 모바일에서도 상단 시세를 유지한다.
포지션 전체 종목의 Mark를 WS당 최대 32개씩 구독하여 표시용 PnL/ROE를 BigInt로 갱신한다.
수량·증거금·Wallet·실현손익은 REST 서버 응답을 유지한다. 호가 클릭은 지정가 선택·가격 입력만 하며 체결은 서버가 결정한다.
Long/Short 레버리지는 독립적으로 설정하며 주문 버튼에 표시한 해당 방향의 값을 전송한다.
지정가 비율은 가격 없이도 선택할 수 있고, 유효한 가격이 없으면 수량을 0으로 채운다.
비율 슬라이더는 0~100%를 1% 단위로, 빠른 선택은 25/50/75/100%로 제공한다.
가격 입력 후 비율을 다시 선택하면 현재 선택 방향의 레버리지로 수량을 계산한다.
잔액·증거금·손익·변동률은 표시만 소수점 두 자리로 반올림하며 수량·종목 가격과 계산 원본은 유지한다.
레버리지는 1~100배 설정·참고 계산을 제공하지만 현재 Runtime OpenAPI/TradingMath/DB 상한은 20배다.
21~100배 주문은 서버 지원 대기로 표시하고 전송하지 않는다. Backend Work가 검증·DB 제약·OpenAPI를 함께 확장한 뒤 `SERVER_MAX_LEVERAGE`를 맞춰야 한다.
거래 활동은 포지션/미체결/주문 내역/포지션 내역/자산으로 구분한다.
Closed Position History API가 없어 포지션 내역은 준비 상태로 표시한다.
강제청산 안내는 새로 조회된 LIQUIDATE 체결 이력만 사용하며 별도 Push를 가정하지 않는다.
미제공 계약과 Backend 협의 항목은 [BACKEND_FOLLOW_UP.md](./BACKEND_FOLLOW_UP.md)에 정리한다.

차트는 `/api/v1/market/candles?tradingSymbolId=...&interval=...&limit=300`의 Mark Price OHLC를 사용한다.
1m/3m/5m/15m/30m/1h/4h/12h/24h를 지원하며, 종목·주기 전환 시 요청과 렌더러를 분리한다.
동일 UTC bucket의 실시간 Mark는 진행 봉을 갱신하고, 재연결·봉 전환 시 서버 이력을 다시 조회한다.
과거 봉 조회 상태와 실시간 WS 상태를 별도로 표시한다. 원본 OHLC는 Decimal 문자열이며
차트 라이브러리에 전달할 때만 숫자로 변환한다.

가격 표시는 공통 `formatMarketPrice`를 사용한다. 유효한 `priceTickSize`를 우선하고,
현재 Symbol 계약처럼 metadata가 없으면 가격 크기에 따라 최대 2/4/6/8자리를 표시한다.
아주 작은 양수는 `<0.00000001`처럼 표시하며 주문 입력·원본 값은 변경하지 않는다.
WS 수신 검증은 서버의 수신 시각 신선도와 provider 시각 편차 정책을 따른다.

주문 브라우저 검증에는 실제 서버와 분리한 계약 응답을 사용한다. 실제 주문 통합 검증에는
Trading Server의 유효한 Mark Price 수신이 필요하다. 테스트 응답은 제품 코드/실제 DB에 넣지 않는다.
